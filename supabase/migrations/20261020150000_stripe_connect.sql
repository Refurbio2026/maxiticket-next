-- Stripe Connect (Express účty) — stĺpce, práva a prepínač brány.
--
-- ČO TU ZÁMERNE NIE JE: tabuľky `organizers`, `events`, `orders`, `tickets`.
-- Zadanie ich chcelo vytvoriť, ale všetky štyri veci tu už existujú a sú
-- plné dát (138 podujatí, 92 objednávok, 1 012 vstupeniek) a organizátori
-- žijú v `profiles` so stavom schválenia, subdoménou a províziou. Vytvoriť
-- ich nanovo by znamenalo druhý systém vedľa bežiaceho. RLS na nich platí
-- a zostáva nedotknuté.
--
-- ČO SI DRŽÍME: len id účtu u Stripe a tri príznaky z `account.updated`.
-- Žiadne doklady ani bankové údaje organizátora — tie zostávajú u Stripe.
--
-- PRÁVA SÚ TU PODSTATNÉ: `stripe_account_id` si organizátor nesmie nastaviť
-- sám. Kto si prepíše toto pole, presmeruje si výplaty za cudzie podujatia.
-- Preto sa stĺpce odoberajú rovnako, ako je už odobraná `commission_rate`
-- a `organizer_status`.

-- 0) Stripe ako hodnota v enume platobných brán -------------------------------
-- Bez tohto by doúčtovanie spadlo pri zápise `orders.payment_provider`.
-- `add value` sa v transakcii vykonať smie, ale použiť tú hodnotu až po
-- commite — preto ju kontrola nižšie neskúša vložiť.
alter type public.payment_provider add value if not exists 'stripe';

-- 1) Stav Stripe účtu organizátora -------------------------------------------
alter table public.profiles
  add column if not exists stripe_account_id text,
  add column if not exists stripe_charges_enabled boolean not null default false,
  add column if not exists stripe_payouts_enabled boolean not null default false,
  add column if not exists stripe_details_submitted boolean not null default false,
  add column if not exists stripe_requirements jsonb,
  add column if not exists stripe_account_updated_at timestamptz;

comment on column public.profiles.stripe_account_id is
  'Express účet organizátora u Stripe (acct_…). Píše len server; organizátor nemá právo zápisu.';
comment on column public.profiles.stripe_charges_enabled is
  'Stripe povolil prijímať platby. Bez toho sa kartou na podujatia organizátora zaplatiť nedá.';

-- Jeden Stripe účet patrí jednému organizátorovi. Keby sa to pomiešalo,
-- `account.updated` by stav zapísal nesprávnemu profilu.
create unique index if not exists profiles_stripe_account_id_key
  on public.profiles (stripe_account_id)
  where stripe_account_id is not null;

-- 2) Audit provízie na objednávke --------------------------------------------
-- `payment_provider` a `payment_ref` už existujú a Stripe ich používa; tieto
-- dva stĺpce sú na to, aby sa po roku dalo doložiť, koľko si platforma vzala
-- a komu išiel zvyšok — bez dotazovania Stripe API.
alter table public.orders
  add column if not exists application_fee_cents integer,
  add column if not exists transfer_destination text;

comment on column public.orders.application_fee_cents is
  'Provízia platformy v centoch, ako bola poslaná Stripe pri zakladaní platby.';
comment on column public.orders.transfer_destination is
  'Stripe účet, na ktorý išiel zvyšok platby (transfer_data[destination]).';

-- 3) Prepínač brány v admine --------------------------------------------------
alter table public.payment_settings
  add column if not exists stripe_enabled boolean not null default true;

-- 4) Práva ---------------------------------------------------------------------
-- Vzor je rovnaký ako pri `commission_rate`: `authenticated` smie meniť len
-- to, čo o sebe meniť má. Nové stĺpce sa z toho výslovne vynímajú.
revoke update (
  stripe_account_id,
  stripe_charges_enabled,
  stripe_payouts_enabled,
  stripe_details_submitted,
  stripe_requirements,
  stripe_account_updated_at
) on public.profiles from authenticated;

revoke update (
  stripe_account_id,
  stripe_charges_enabled,
  stripe_payouts_enabled,
  stripe_details_submitted,
  stripe_requirements,
  stripe_account_updated_at
) on public.profiles from anon;

revoke insert (
  stripe_account_id,
  stripe_charges_enabled,
  stripe_payouts_enabled,
  stripe_details_submitted,
  stripe_requirements,
  stripe_account_updated_at
) on public.profiles from authenticated, anon;

-- Organizátor svoj stav **vidieť** má — potrebuje vedieť, či mu Stripe už
-- povolil platby. Čítanie teda zostáva (riadky filtruje RLS na `profiles`).

revoke update (application_fee_cents, transfer_destination)
  on public.orders from authenticated, anon;

-- Service role (server) píše všetko; explicitne, nech to nestojí na dedení.
grant update (
  stripe_account_id,
  stripe_charges_enabled,
  stripe_payouts_enabled,
  stripe_details_submitted,
  stripe_requirements,
  stripe_account_updated_at
) on public.profiles to service_role;

grant update (application_fee_cents, transfer_destination) on public.orders to service_role;

-- 5) Kontrola -----------------------------------------------------------------
do $$
declare
  zle text := '';
begin
  if has_column_privilege('authenticated', 'public.profiles', 'stripe_account_id', 'UPDATE') then
    zle := zle || 'authenticated môže meniť stripe_account_id; ';
  end if;
  -- Pri `anon` sa práva po stĺpcoch nemerajú: Supabase mu dáva **tabuľkové**
  -- UPDATE a to odobranie po stĺpcoch neprebije. Anonymovi zápis bráni RLS —
  -- na `profiles` nemá ani jednu zápisovú politiku. To je to, čo treba držať.
  if exists (
    select 1 from pg_policies
    where schemaname = 'public' and tablename = 'profiles'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
      and roles::text[] && array['anon', 'public']
  ) then
    zle := zle || 'anon má zápisovú politiku na profiles; ';
  end if;
  if not has_column_privilege('authenticated', 'public.profiles', 'display_name', 'UPDATE') then
    zle := zle || 'organizátor stratil právo na display_name; ';
  end if;
  if not has_column_privilege('service_role', 'public.profiles', 'stripe_account_id', 'UPDATE') then
    zle := zle || 'service_role nemôže písať stripe_account_id; ';
  end if;
  if zle <> '' then
    raise exception 'Migrácia Stripe Connect: %', zle;
  end if;
  raise notice 'Stripe Connect: práva v poriadku';
end $$;
