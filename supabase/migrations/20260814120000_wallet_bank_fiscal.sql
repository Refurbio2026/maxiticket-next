-- Wallet nastavenia, bankové výpisy a eKasa do databázy.
--
-- Tri posledné veci z admina, ktoré držali dáta v localStorage prehliadača:
-- nastavenie sa teda týkalo jedného počítača, výpisy z banky videl len ten,
-- kto ich naimportoval, a fiškálne doklady sa pri vymazaní cache stratili.

-- --- Wallet passy -------------------------------------------------------
-- Jediný riadok pre celú platformu (rovnako ako `platform_settings`).
-- Certifikáty a servisné kľúče sem NEPATRIA — tie žijú v secrets
-- (`GOOGLE_WALLET_*`); tu je len to, čo sa dá ukázať v admine.

create table if not exists public.wallet_settings (
  id boolean primary key default true,
  apple_enabled boolean not null default false,
  apple_pass_type_identifier text,
  apple_team_identifier text,
  apple_organization_name text not null default 'vipky.sk',
  google_enabled boolean not null default false,
  google_issuer_id text,
  google_issuer_name text not null default 'vipky.sk',
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint wallet_settings_single_row check (id)
);

insert into public.wallet_settings (id) values (true) on conflict do nothing;

drop trigger if exists trg_wallet_settings_updated_at on public.wallet_settings;
create trigger trg_wallet_settings_updated_at
  before update on public.wallet_settings
  for each row execute function public.update_updated_at_column();

-- --- Bankové účty a pohyby ----------------------------------------------
-- Slúži na párovanie prijatých platieb s objednávkami. Variabilný symbol je
-- prvých osem znakov id objednávky (rovnako ako pri GoPay a faktúrach).

create table if not exists public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  bank_name text not null,
  account_name text not null,
  iban text not null,
  currency text not null default 'EUR',
  balance numeric(14, 2) not null default 0,
  connected boolean not null default false,
  last_sync_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists bank_accounts_iban_key on public.bank_accounts (upper(iban));

drop trigger if exists trg_bank_accounts_updated_at on public.bank_accounts;
create trigger trg_bank_accounts_updated_at
  before update on public.bank_accounts
  for each row execute function public.update_updated_at_column();

create table if not exists public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.bank_accounts (id) on delete cascade,
  booked_on date not null,
  amount numeric(14, 2) not null,
  currency text not null default 'EUR',
  counterparty_name text,
  counterparty_iban text,
  variable_symbol text,
  message text,
  match_status text not null default 'unmatched'
    check (match_status in ('matched', 'unmatched', 'pending')),
  matched_order_id uuid references public.orders (id) on delete set null,
  -- Zabráni dvojitému importu toho istého pohybu z výpisu.
  external_id text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bank_transactions_account_idx
  on public.bank_transactions (account_id, booked_on desc);
create index if not exists bank_transactions_status_idx on public.bank_transactions (match_status);
create unique index if not exists bank_transactions_external_key
  on public.bank_transactions (account_id, external_id) where external_id is not null;

drop trigger if exists trg_bank_transactions_updated_at on public.bank_transactions;
create trigger trg_bank_transactions_updated_at
  before update on public.bank_transactions
  for each row execute function public.update_updated_at_column();

-- --- eKasa / ORP --------------------------------------------------------
-- Samotné odosielanie do eKasy je stále simulácia (`fiscal-adapter.ts`) —
-- chýba certifikát a poskytovateľ. V databáze je nastavenie a evidencia
-- vystavených dokladov, aby sa nestratili s cache prehliadača.

create table if not exists public.fiscal_settings (
  organizer_id uuid primary key references auth.users (id) on delete cascade,
  enabled boolean not null default false,
  provider text,
  cash_register_code text,
  dic text,
  ic_dph text,
  endpoint_url text,
  connection_status text not null default 'disconnected'
    check (connection_status in ('connected', 'disconnected', 'error')),
  last_check_at timestamptz,
  note text,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_fiscal_settings_updated_at on public.fiscal_settings;
create trigger trg_fiscal_settings_updated_at
  before update on public.fiscal_settings
  for each row execute function public.update_updated_at_column();

create table if not exists public.fiscal_receipts (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references auth.users (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  receipt_number text not null,
  -- Unikátny identifikátor dokladu z eKasy (OKP/PKP), keď príde.
  fiscal_code text,
  total_amount numeric(12, 2) not null default 0,
  payment_method text,
  status text not null default 'issued' check (status in ('issued', 'cancelled', 'error')),
  error_message text,
  issued_at timestamptz not null default now(),
  cancelled_at timestamptz
);

create index if not exists fiscal_receipts_organizer_idx
  on public.fiscal_receipts (organizer_id, issued_at desc);
create index if not exists fiscal_receipts_order_idx on public.fiscal_receipts (order_id);

-- --- Prístupové práva ---------------------------------------------------

alter table public.wallet_settings enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.bank_transactions enable row level security;
alter table public.fiscal_settings enable row level security;
alter table public.fiscal_receipts enable row level security;

-- Wallet a banka sú veci platformy, nie organizátora.
drop policy if exists wallet_settings_admin on public.wallet_settings;
create policy wallet_settings_admin on public.wallet_settings
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists bank_accounts_admin on public.bank_accounts;
create policy bank_accounts_admin on public.bank_accounts
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists bank_transactions_admin on public.bank_transactions;
create policy bank_transactions_admin on public.bank_transactions
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

-- eKasa patrí organizátorovi, ktorý na mieste predáva.
drop policy if exists fiscal_settings_owner on public.fiscal_settings;
create policy fiscal_settings_owner on public.fiscal_settings
  for all to authenticated
  using (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role))
  with check (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists fiscal_receipts_owner on public.fiscal_receipts;
create policy fiscal_receipts_owner on public.fiscal_receipts
  for all to authenticated
  using (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role))
  with check (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role));

grant select, insert, update, delete on public.wallet_settings to authenticated;
grant select, insert, update, delete on public.bank_accounts to authenticated;
grant select, insert, update, delete on public.bank_transactions to authenticated;
grant select, insert, update, delete on public.fiscal_settings to authenticated;
grant select, insert, update, delete on public.fiscal_receipts to authenticated;
