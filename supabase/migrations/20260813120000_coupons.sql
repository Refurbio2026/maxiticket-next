-- Zľavové kupóny.
--
-- Doteraz kupóny neexistovali vôbec: checkout o nich nevedel a pokladňa mala
-- natvrdo zapísanú trojicu kódov priamo v komponente, takže zľavu vedel
-- ktokoľvek prečítať z JavaScriptu a použiť donekonečna.
--
-- Kupón je teraz riadok v databáze a uplatňuje ho SERVER. Počet použití sa
-- inkrementuje v tej istej transakcii, v ktorej sa kupón kontroluje
-- (`check_coupon(..., p_claim => true)`), takže dvaja súbežní kupujúci
-- nemôžu obaja minúť posledné použitie.

create table if not exists public.coupons (
  id uuid primary key default gen_random_uuid(),
  code text not null,
  -- NULL = kupón platformy (zakladá admin) a platí na všetky podujatia.
  organizer_id uuid references auth.users (id) on delete cascade,
  -- NULL = platí na všetky podujatia daného organizátora.
  event_id uuid references public.events (id) on delete cascade,
  discount_type text not null default 'percent' check (discount_type in ('percent', 'amount')),
  discount_value numeric(12, 2) not null check (discount_value > 0),
  -- NULL alebo 0 = bez limitu.
  max_uses integer,
  max_uses_per_email integer,
  used_count integer not null default 0,
  min_order_amount numeric(12, 2) not null default 0,
  valid_from date,
  valid_until date,
  status text not null default 'active' check (status in ('active', 'paused')),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Kód je jedinečný naprieč platformou. Kupón sa zadáva do jedného políčka bez
-- toho, aby kupujúci vedel, komu patrí — dva rovnaké kódy by nebolo ako rozlíšiť.
create unique index if not exists coupons_code_unique on public.coupons (upper(code));
create index if not exists coupons_organizer_idx on public.coupons (organizer_id);
create index if not exists coupons_event_idx on public.coupons (event_id);

drop trigger if exists trg_coupons_updated_at on public.coupons;
create trigger trg_coupons_updated_at
  before update on public.coupons
  for each row execute function public.update_updated_at_column();

-- Každé uplatnenie má svoj riadok — z neho sa počíta limit na e-mail aj
-- prehľad využitia. `used_count` na kupóne je len rýchly odpočet.
create table if not exists public.coupon_redemptions (
  id uuid primary key default gen_random_uuid(),
  coupon_id uuid not null references public.coupons (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  email text,
  discount_amount numeric(12, 2) not null default 0,
  created_at timestamptz not null default now()
);

-- Na objednávku smie ísť najviac jeden kupón.
create unique index if not exists coupon_redemptions_order_unique
  on public.coupon_redemptions (order_id) where order_id is not null;
create index if not exists coupon_redemptions_coupon_idx
  on public.coupon_redemptions (coupon_id, created_at desc);

alter table public.orders
  add column if not exists coupon_id uuid references public.coupons (id) on delete set null;

-- --- Kontrola a uplatnenie --------------------------------------------
-- Jedna funkcia pre náhľad aj pre uplatnenie. `p_claim => false` len počíta
-- (checkout ukáže zľavu ešte pred zaplatením), `p_claim => true` zároveň
-- zvýši počítadlo. Riadok kupónu je uzamknutý (`for update`), takže kontrola
-- a inkrement sa nedajú rozdeliť.
--
-- Chybu vraciame kódom, nie výnimkou — volajúci si preloží hlášku do
-- slovenčiny a rozhodne, či nákup zastaví.

create or replace function public.check_coupon(
  p_code text,
  p_event_id uuid,
  p_amount numeric,
  p_email text default null,
  p_claim boolean default false
)
returns table (coupon_id uuid, discount numeric, error_code text)
language plpgsql
security definer
set search_path = public
as $$
declare
  c public.coupons%rowtype;
  v_owner uuid;
  v_used int;
  v_disc numeric;
  v_today date := (now() at time zone 'Europe/Bratislava')::date;
begin
  select * into c from public.coupons
   where upper(code) = upper(btrim(p_code))
   for update;

  if not found then
    return query select null::uuid, 0::numeric, 'not_found'::text;
    return;
  end if;

  if c.status <> 'active' then
    return query select c.id, 0::numeric, 'inactive'::text;
    return;
  end if;

  if c.valid_from is not null and v_today < c.valid_from then
    return query select c.id, 0::numeric, 'not_yet'::text;
    return;
  end if;

  if c.valid_until is not null and v_today > c.valid_until then
    return query select c.id, 0::numeric, 'expired'::text;
    return;
  end if;

  -- Kupón viazaný na podujatie platí len naň; kupón organizátora na všetky
  -- jeho podujatia; kupón bez organizátora (od admina) na čokoľvek.
  if c.event_id is not null then
    if c.event_id is distinct from p_event_id then
      return query select c.id, 0::numeric, 'wrong_event'::text;
      return;
    end if;
  elsif c.organizer_id is not null then
    select organizer_id into v_owner from public.events where id = p_event_id;
    if v_owner is distinct from c.organizer_id then
      return query select c.id, 0::numeric, 'wrong_event'::text;
      return;
    end if;
  end if;

  if c.min_order_amount > 0 and p_amount < c.min_order_amount then
    return query select c.id, 0::numeric, 'min_amount'::text;
    return;
  end if;

  if coalesce(c.max_uses, 0) > 0 and c.used_count >= c.max_uses then
    return query select c.id, 0::numeric, 'exhausted'::text;
    return;
  end if;

  if coalesce(c.max_uses_per_email, 0) > 0 and p_email is not null then
    select count(*) into v_used
      from public.coupon_redemptions r
     where r.coupon_id = c.id and lower(r.email) = lower(p_email);
    if v_used >= c.max_uses_per_email then
      return query select c.id, 0::numeric, 'email_limit'::text;
      return;
    end if;
  end if;

  if c.discount_type = 'percent' then
    v_disc := round(p_amount * c.discount_value / 100, 2);
  else
    v_disc := c.discount_value;
  end if;
  if v_disc > p_amount then v_disc := p_amount; end if;

  if p_claim then
    update public.coupons set used_count = used_count + 1 where id = c.id;
  end if;

  return query select c.id, v_disc, null::text;
end;
$$;

-- Vrátenie použitia, keď objednávka po uplatnení kupónu predsa len neprešla
-- (napr. sedadlo medzitým vzal niekto iný).
create or replace function public.release_coupon(p_coupon_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.coupons
     set used_count = greatest(0, used_count - 1)
   where id = p_coupon_id;
$$;

-- Kupón overuje výhradne server cez service role. Keby smel `anon`, dal by sa
-- kód uhádnuť dotazom na tabuľku.
revoke execute on function public.check_coupon(text, uuid, numeric, text, boolean) from anon, authenticated, public;
revoke execute on function public.release_coupon(uuid) from anon, authenticated, public;

-- --- Prístupové práva ---------------------------------------------------

alter table public.coupons enable row level security;
alter table public.coupon_redemptions enable row level security;

drop policy if exists coupons_owner_all on public.coupons;
create policy coupons_owner_all on public.coupons
  for all to authenticated
  using (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role))
  with check (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists coupon_redemptions_owner_read on public.coupon_redemptions;
create policy coupon_redemptions_owner_read on public.coupon_redemptions
  for select to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::app_role)
    or exists (
      select 1 from public.coupons c
       where c.id = coupon_redemptions.coupon_id and c.organizer_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.coupons to authenticated;
grant select on public.coupon_redemptions to authenticated;
