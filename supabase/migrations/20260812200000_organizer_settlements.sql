-- Vyúčtovanie organizátorom.
--
-- Doteraz sa predaj dal vybrať, ale organizátorovi nebolo ako vyplatiť tržbu ani
-- doložiť, z čoho suma vznikla. Zavádzame:
--   1. fakturačné a výplatné údaje organizátora v `profiles` (dovtedy sa strácali
--      v `auth.users.raw_user_meta_data`, kam ich zapísala registrácia),
--   2. províziu ako percento na organizátora,
--   3. tabuľku `settlements` — vyúčtovací protokol za obdobie.

-- ---------------------------------------------------------------- profily
alter table public.profiles
  add column if not exists company_name text,
  add column if not exists ico text,
  add column if not exists dic text,
  add column if not exists ic_dph text,
  add column if not exists billing_address text,
  add column if not exists phone text,
  add column if not exists payout_iban text,
  -- NULL = platí predvolená sadzba platformy (viď `platform_settings`).
  add column if not exists commission_rate numeric(5, 2);

alter table public.profiles
  add constraint profiles_commission_rate_range
  check (commission_rate is null or (commission_rate >= 0 and commission_rate <= 100));

-- Registračný formulár tieto údaje posiela do metadát už teraz, len ich nikto
-- nečítal. Dobehneme, čo sa dá, pre už existujúce účty.
update public.profiles p
set company_name    = coalesce(p.company_name, u.raw_user_meta_data ->> 'company_name'),
    ico             = coalesce(p.ico, u.raw_user_meta_data ->> 'ico'),
    dic             = coalesce(p.dic, u.raw_user_meta_data ->> 'dic'),
    ic_dph          = coalesce(p.ic_dph, u.raw_user_meta_data ->> 'ic_dph'),
    billing_address = coalesce(p.billing_address, u.raw_user_meta_data ->> 'billing_address'),
    phone           = coalesce(p.phone, u.raw_user_meta_data ->> 'phone')
from auth.users u
where u.id = p.id;

-- A odteraz nech ich trigger prepisuje do profilu rovno pri registrácii.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (
    id, full_name, company_name, ico, dic, ic_dph, billing_address, phone
  )
  values (
    new.id,
    coalesce(new.raw_user_meta_data ->> 'full_name', new.email),
    new.raw_user_meta_data ->> 'company_name',
    new.raw_user_meta_data ->> 'ico',
    new.raw_user_meta_data ->> 'dic',
    new.raw_user_meta_data ->> 'ic_dph',
    new.raw_user_meta_data ->> 'billing_address',
    new.raw_user_meta_data ->> 'phone'
  );
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end;
$$;

-- Admin musí vidieť a upravovať profily organizátorov (dovtedy platilo len
-- „vlastný profil"). Server ide cez service_role, ale nech sedí aj RLS.
drop policy if exists profiles_admin_select on public.profiles;
create policy profiles_admin_select on public.profiles
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

drop policy if exists profiles_admin_update on public.profiles;
create policy profiles_admin_update on public.profiles
  for update to authenticated
  using (public.has_role(auth.uid(), 'admin'));

-- ------------------------------------------------- predvolená sadzba platformy
create table if not exists public.platform_settings (
  id boolean primary key default true check (id),   -- jediný riadok
  default_commission_rate numeric(5, 2) not null default 10.00
    check (default_commission_rate >= 0 and default_commission_rate <= 100),
  updated_at timestamptz not null default now()
);
insert into public.platform_settings (id) values (true) on conflict (id) do nothing;

alter table public.platform_settings enable row level security;

create policy platform_settings_read on public.platform_settings
  for select to authenticated using (true);

create policy platform_settings_admin_write on public.platform_settings
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

grant select on public.platform_settings to authenticated;
grant all on public.platform_settings to service_role;

-- ---------------------------------------------------------- vyúčtovací protokol
do $$ begin
  create type public.settlement_status as enum ('draft', 'approved', 'paid');
exception when duplicate_object then null;
end $$;

create table if not exists public.settlements (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references auth.users(id) on delete restrict,
  -- NULL = vyúčtovanie za všetky podujatia organizátora v danom období.
  event_id uuid references public.events(id) on delete set null,
  period_from date not null,
  period_to date not null,
  -- Čísla sa zmrazia pri vytvorení protokolu. Neskoršia refundácia či zmena
  -- ceny už nesmie prepísať to, čo bolo organizátorovi odsúhlasené.
  tickets_sold integer not null default 0,
  gross_amount numeric(12, 2) not null default 0,
  commission_rate numeric(5, 2) not null default 0,
  commission_amount numeric(12, 2) not null default 0,
  refunded_amount numeric(12, 2) not null default 0,
  net_amount numeric(12, 2) not null default 0,
  status public.settlement_status not null default 'draft',
  note text,
  paid_at timestamptz,
  payout_reference text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_to >= period_from)
);

create index if not exists settlements_organizer_idx on public.settlements (organizer_id);
create index if not exists settlements_period_idx on public.settlements (period_from, period_to);

alter table public.settlements enable row level security;

-- Organizátor vidí svoje protokoly, admin všetky. Zapisuje výhradne admin.
create policy settlements_owner_select on public.settlements
  for select to authenticated
  using (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

create policy settlements_admin_write on public.settlements
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

grant select on public.settlements to authenticated;
grant all on public.settlements to service_role;

create trigger trg_settlements_updated_at
  before update on public.settlements
  for each row execute function public.update_updated_at_column();
