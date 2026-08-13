-- POS (predaj na mieste) do databázy.
--
-- Doteraz žil celý POS v localStorage prehliadača: predaj z pokladne sa nikdy
-- nedostal do `orders`, vstupenka z pokladne nemala platný QR (skener ju
-- nepoznal) a tržba z miesta chýbala v štatistikách aj vo vyúčtovaní
-- organizátorovi. Druhá pokladňa v tej istej hale o prvej nevedela vôbec.
--
-- Predaj z pokladne teraz vytvára tie isté `orders` / `order_items` /
-- `tickets` ako web — líši sa len kanálom a spôsobom platby. Vďaka tomu
-- funguje skener, PDF, kapacita aj provízia bez ďalšej vetvy v kóde.
--
-- eKasa (fiškálny doklad) je samostatná téma: vyžaduje certifikát a zmluvu
-- s poskytovateľom, takže tu je len miesto, kam sa číslo dokladu zapíše.

-- --- Pokladníci -------------------------------------------------------
-- PIN sa neukladá otvorene. Hashuje ho SERVER (HMAC-SHA256 s tajomstvom
-- aplikácie) — štvorciferný PIN má len 10 000 možností, takže obyčajný
-- SHA-256 by sa dal prelúskať tabuľkou za sekundu.

create table if not exists public.pos_cashiers (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references auth.users (id) on delete cascade,
  first_name text not null,
  last_name text not null,
  display_name text not null,
  pin_hash text not null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  permissions text[] not null default array['sale']::text[],
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists pos_cashiers_organizer_idx on public.pos_cashiers (organizer_id);

drop trigger if exists trg_pos_cashiers_updated_at on public.pos_cashiers;
create trigger trg_pos_cashiers_updated_at
  before update on public.pos_cashiers
  for each row execute function public.update_updated_at_column();

-- --- Smeny ------------------------------------------------------------
-- Smena viaže predaje na konkrétneho pokladníka a je základom uzávierky.
-- Otvorená smena smie byť na pokladníka len jedna.

create table if not exists public.pos_sessions (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references auth.users (id) on delete cascade,
  cashier_id uuid not null references public.pos_cashiers (id) on delete restrict,
  status text not null default 'open' check (status in ('open', 'closed')),
  opened_at timestamptz not null default now(),
  closed_at timestamptz,
  opening_cash numeric(12, 2) not null default 0,
  closing_cash numeric(12, 2),
  note text
);

create unique index if not exists pos_sessions_one_open_per_cashier
  on public.pos_sessions (cashier_id) where status = 'open';
create index if not exists pos_sessions_organizer_idx on public.pos_sessions (organizer_id);

-- --- Uzávierky --------------------------------------------------------
-- Uzávierka je zmrazený doklad: neskorší predaj ani storno ňou už nehýbe.

create table if not exists public.pos_closings (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references auth.users (id) on delete cascade,
  session_id uuid references public.pos_sessions (id) on delete set null,
  cashier_id uuid references public.pos_cashiers (id) on delete set null,
  period_from timestamptz not null,
  period_to timestamptz not null,
  orders_count integer not null default 0,
  tickets_count integer not null default 0,
  cash_total numeric(12, 2) not null default 0,
  card_total numeric(12, 2) not null default 0,
  transfer_total numeric(12, 2) not null default 0,
  free_total numeric(12, 2) not null default 0,
  gross_total numeric(12, 2) not null default 0,
  voided_count integer not null default 0,
  voided_total numeric(12, 2) not null default 0,
  opening_cash numeric(12, 2) not null default 0,
  counted_cash numeric(12, 2),
  cash_difference numeric(12, 2),
  note text,
  created_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pos_closings_organizer_idx on public.pos_closings (organizer_id, created_at desc);

-- --- Objednávka vie, odkiaľ prišla -------------------------------------

alter table public.orders
  add column if not exists channel text not null default 'web'
    check (channel in ('web', 'pos')),
  add column if not exists payment_method text
    check (payment_method is null or payment_method in ('gopay', 'cash', 'card', 'transfer', 'free')),
  add column if not exists cashier_id uuid references public.pos_cashiers (id) on delete set null,
  add column if not exists pos_session_id uuid references public.pos_sessions (id) on delete set null,
  add column if not exists receipt_number text,
  add column if not exists discount_amount numeric(12, 2) not null default 0,
  add column if not exists promo_code text,
  add column if not exists void_reason text,
  add column if not exists fiscal_receipt_id text;

create index if not exists orders_channel_idx on public.orders (channel, created_at desc);
create index if not exists orders_pos_session_idx on public.orders (pos_session_id);

-- Doterajšie objednávky prišli z webu cez GoPay.
update public.orders set payment_method = 'gopay' where payment_method is null;

-- --- Číslovanie dokladov ----------------------------------------------
-- Rad na organizátora a rok, aby doklady nemali diery ani duplicity.
-- Inkrement je jeden atomický príkaz, takže dve pokladne naraz nedostanú
-- to isté číslo.

create table if not exists public.pos_receipt_counters (
  organizer_id uuid not null references auth.users (id) on delete cascade,
  year integer not null,
  last_number integer not null default 0,
  primary key (organizer_id, year)
);

create or replace function public.next_receipt_number(p_organizer_id uuid)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_year int := extract(year from now())::int;
  v_num int;
begin
  insert into public.pos_receipt_counters (organizer_id, year, last_number)
  values (p_organizer_id, v_year, 1)
  on conflict (organizer_id, year)
    do update set last_number = pos_receipt_counters.last_number + 1
  returning last_number into v_num;

  return v_year || '/' || lpad(v_num::text, 6, '0');
end;
$$;

revoke execute on function public.next_receipt_number(uuid) from anon, authenticated, public;

-- --- Prístupové práva ---------------------------------------------------
-- Pokladníci, smeny aj uzávierky patria organizátorovi. Zákazník k nim nemá
-- čo hľadať a jeden organizátor nesmie vidieť tržby druhého.

alter table public.pos_cashiers enable row level security;
alter table public.pos_sessions enable row level security;
alter table public.pos_closings enable row level security;
alter table public.pos_receipt_counters enable row level security;

drop policy if exists pos_cashiers_owner_all on public.pos_cashiers;
create policy pos_cashiers_owner_all on public.pos_cashiers
  for all to authenticated
  using (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role))
  with check (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists pos_sessions_owner_all on public.pos_sessions;
create policy pos_sessions_owner_all on public.pos_sessions
  for all to authenticated
  using (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role))
  with check (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists pos_closings_owner_all on public.pos_closings;
create policy pos_closings_owner_all on public.pos_closings
  for all to authenticated
  using (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role))
  with check (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role));

-- Počítadlo dokladov nikto nečíta priamo — hýbe s ním len `next_receipt_number`.
drop policy if exists pos_receipt_counters_admin on public.pos_receipt_counters;
create policy pos_receipt_counters_admin on public.pos_receipt_counters
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

grant select, insert, update, delete on public.pos_cashiers to authenticated;
grant select, insert, update, delete on public.pos_sessions to authenticated;
grant select, insert, update, delete on public.pos_closings to authenticated;
