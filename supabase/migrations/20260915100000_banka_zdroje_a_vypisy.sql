-- Párovanie bankových výpisov, 1. časť: odkiaľ transakcie chodia a za aké obdobie.
--
-- Doteraz sa pohyby dali len ručne naimportovať a účet bol holý IBAN. Aby sa
-- dalo sťahovať z API a kontrolovať mesačné zostatky, pribúda evidencia
-- zdrojov (`bank_statement_sources`) a súhrn výpisu (`bank_statements`).
--
-- Druhá tabuľka transakcií tu zámerne NEVZNIKÁ. Operatívne párovanie aj
-- mesačné účtovníctvo pracujú nad jednou `bank_transactions` — starý systém
-- ich mal oddelené (`bank_statement` vs `acc_bank_movement`) a tá istá platba
-- sa v ňom evidovala dvakrát, zakaždým inak.

-- --- Bankové a pseudo účty ----------------------------------------------
-- Brána nie je banka a IBAN nemá: GoPay či CardPay sa v starom systéme
-- identifikovali textom ako `MAXITICKET.CARDPAY`. Preto `iban` prestáva byť
-- povinný a pribúda `psp_key` pre účty typu brána.

alter table public.bank_accounts
  add column if not exists provider text,
  add column if not exists kind text not null default 'bank',
  add column if not exists psp_key text,
  add column if not exists owner_name text,
  add column if not exists active boolean not null default true;

alter table public.bank_accounts alter column iban drop not null;

do $$ begin
  alter table public.bank_accounts
    add constraint bank_accounts_kind_check check (kind in ('bank', 'psp'));
exception when duplicate_object then null;
end $$;

do $$ begin
  alter table public.bank_accounts
    add constraint bank_accounts_provider_check check (
      provider is null or provider in (
        'fio', 'csob', 'tatrabanka', 'slsp', 'vub',
        'gopay', 'gpwebpay', 'tatrapayplus', 'comgate', 'other'
      )
    );
exception when duplicate_object then null;
end $$;

-- Účet je buď banka s IBAN-om, alebo brána s kľúčom. Bez tohto by sa dal
-- založiť účet, ktorý sa nedá identifikovať ani jedným spôsobom, a pohyby
-- z neho by nemali kam padnúť.
do $$ begin
  alter table public.bank_accounts
    add constraint bank_accounts_identifikator_check check (
      (kind = 'bank' and iban is not null) or (kind = 'psp' and psp_key is not null)
    );
exception when duplicate_object then null;
end $$;

-- Pôvodný unikátny index na `upper(iban)` by pri NULL prešiel, ale nechceme
-- sa spoliehať na to — index sa prestaví na čiastočný a pribudne kľúč brány.
drop index if exists public.bank_accounts_iban_key;
create unique index if not exists bank_accounts_iban_key
  on public.bank_accounts (upper(iban)) where iban is not null;
create unique index if not exists bank_accounts_psp_key
  on public.bank_accounts (upper(psp_key)) where psp_key is not null;

comment on column public.bank_accounts.kind is
  'bank = účet s IBAN-om, psp = pseudo účet platobnej brány (GoPay, CardPay).';
comment on column public.bank_accounts.owner_name is
  'Majiteľ účtu pre export camt.053. Starý systém ho mal napevno v kóde.';

-- --- Zdroje transakcií --------------------------------------------------
-- Odkiaľ sa na účet dostávajú pohyby: REST API banky, nahratý mesačný výpis,
-- alebo ručný zápis. Hodnota `imap` je v číselníku, ale adaptér k nej zatiaľ
-- neexistuje — e-mailové avízo sa dá podvrhnúť (stačí sfalšovať `From`)
-- a dokončiť objednávku na jeho základe by znamenalo vydať vstupenky komukoľvek.

create table if not exists public.bank_statement_sources (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.bank_accounts (id) on delete cascade,
  name text not null,
  kind text not null check (kind in ('api', 'upload', 'imap', 'manual')),
  provider text not null,
  enabled boolean not null default true,
  -- Netajné nastavenie (adresa API, číslo terminálu, šírka okna…).
  config jsonb not null default '{}'::jsonb,
  -- Token či heslo šifrované cez `secrets.server.ts` (AES-256-GCM). Do
  -- prehliadača sa nevracia nikdy, len náhľad typu `••••1234`.
  secret_enc text,
  -- Okno sťahovania sa prekrýva, aby transakcia nevypadla medzi dvoma behmi.
  window_days smallint not null default 2 check (window_days between 1 and 31),
  last_success_at timestamptz,
  last_error text,
  last_error_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists bank_statement_sources_account_idx
  on public.bank_statement_sources (account_id);

drop trigger if exists trg_bank_statement_sources_updated_at on public.bank_statement_sources;
create trigger trg_bank_statement_sources_updated_at
  before update on public.bank_statement_sources
  for each row execute function public.update_updated_at_column();

-- --- Mesačný súhrn výpisu -----------------------------------------------
-- Z neho sa počíta kontrola „počiatočný + kredity − debety − poplatky =
-- koncový" a nadväznosť mesiacov. Počty pohybov sú `integer`, nie `smallint`
-- ako v starom systéme — ten sa zastavil na 65 535 pohyboch za obdobie.

create table if not exists public.bank_statements (
  id uuid primary key default gen_random_uuid(),
  account_id uuid not null references public.bank_accounts (id) on delete cascade,
  source_id uuid references public.bank_statement_sources (id) on delete set null,
  period_from date not null,
  period_to date not null,
  opening_balance numeric(14, 2),
  closing_balance numeric(14, 2),
  credit_sum numeric(14, 2) not null default 0,
  debit_sum numeric(14, 2) not null default 0,
  charges_sum numeric(14, 2) not null default 0,
  credit_count integer not null default 0,
  debit_count integer not null default 0,
  currency text not null default 'EUR',
  file_name text,
  imported_by uuid references auth.users (id) on delete set null,
  imported_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_to >= period_from)
);

-- Opakovaný import toho istého obdobia súhrn prepíše, nezaloží druhý.
create unique index if not exists bank_statements_obdobie_key
  on public.bank_statements (account_id, period_from, period_to);
create index if not exists bank_statements_account_idx
  on public.bank_statements (account_id, period_from desc);

drop trigger if exists trg_bank_statements_updated_at on public.bank_statements;
create trigger trg_bank_statements_updated_at
  before update on public.bank_statements
  for each row execute function public.update_updated_at_column();

-- --- Prístupové práva ---------------------------------------------------

alter table public.bank_statement_sources enable row level security;
alter table public.bank_statements enable row level security;

-- Zdroje nesú šifrované tokeny k bankovým API. Nemajú RLS politiku vôbec —
-- rovnako ako `payment_credentials` sa k nim nedostane ani prihlásený admin
-- priamo cez API, len service role cez serverové funkcie.
revoke all on table public.bank_statement_sources from anon, authenticated;
grant all on table public.bank_statement_sources to service_role;

comment on table public.bank_statement_sources is
  'Zdroje bankových pohybov. Bez RLS politiky — obsahuje šifrované prístupy '
  'k API bánk, číta ich len service role cez serverové funkcie.';

drop policy if exists bank_statements_admin on public.bank_statements;
create policy bank_statements_admin on public.bank_statements
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

grant select, insert, update, delete on public.bank_statements to authenticated;
