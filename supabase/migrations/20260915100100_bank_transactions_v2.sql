-- Párovanie bankových výpisov, 2. časť: jedna tabuľka transakcií pre obe cesty.
--
-- `bank_transactions` doteraz vedela len to, čo potreboval ručný import:
-- dátum, sumu, VS a správu. Aby uniesla operatívne párovanie (dokončiť
-- objednávku z výpisu) aj mesačné účtovníctvo, pribúdajú chýbajúce polia
-- a stavový automat.
--
-- Tri veci, ktoré starý systém robil zle a tu sa opravujú:
--
-- 1. **VS ako číslo.** Starý `bank_statement.vs` bol `bigint`, takže
--    `0015501234` sa uložilo ako `15501234` a nuly zľava sa stratili. Tu je
--    VS text a `vs_normalized` je doplnený nulami na 10 znakov.
-- 2. **Jeden dátum na dve veci.** Starý stĺpec `created` niesol raz čas
--    odoslania e-mailu, raz čas spracovania, raz dátum transakcie — a podľa
--    neho sa rozhodovalo, či sa platba vôbec spracuje. Tu je `booked_at`
--    dátum z banky a `received_at` čas, keď to prišlo k nám.
-- 3. **Stav rozprataný do troch stĺpcov.** Starý systém kombinoval `tickets`
--    (0/1/2) a `id_global_theater` (NULL/0/id) a niektoré kombinácie
--    znamenali „uviaznuté" — platba sa nedokončila a ani sa neobjavila medzi
--    nespárovanými. Tu je jeden stĺpec `status` a každá hodnota je viditeľná.

alter table public.bank_transactions
  add column if not exists source_id uuid references public.bank_statement_sources (id) on delete set null,
  add column if not exists statement_id uuid references public.bank_statements (id) on delete set null,
  -- Dátum a čas transakcie podľa banky.
  add column if not exists booked_at timestamptz,
  add column if not exists value_date date,
  -- Kedy sme ju prevzali my. Oddelene, aby sa nedali zameniť.
  add column if not exists received_at timestamptz not null default now(),
  add column if not exists specific_symbol text,
  add column if not exists constant_symbol text,
  -- VS doplnený nulami zľava na 10 znakov (normalizácia podľa špecifikácie).
  add column if not exists vs_normalized text,
  -- ID transakcie u brány (TID pri CardPay, payment id pri GoPay). Podľa neho
  -- sa dohľadá pôvodná platba pri chargebacku.
  add column if not exists provider_tx_id text,
  -- Originál zo zdroja, šifrovaný. Retencia ho po čase zmaže — sú v ňom
  -- čísla kariet a osobné údaje, ktoré po spárovaní na nič nepotrebujeme.
  add column if not exists raw_payload_enc text,
  add column if not exists status text,
  add column if not exists review_reason text,
  add column if not exists duplicate_of uuid references public.bank_transactions (id) on delete set null,
  add column if not exists manual_change boolean not null default false,
  add column if not exists note text;

-- --- Prechod na nový stavový automat ------------------------------------

update public.bank_transactions
   set booked_at = coalesce(booked_at, booked_on::timestamptz)
 where booked_at is null;

update public.bank_transactions
   set status = coalesce(
         status,
         case match_status
           when 'matched' then 'matched'
           when 'pending' then 'parsed'
           else 'needs_review'
         end
       )
 where status is null;

-- Nespárovaná platba je od začiatku `needs_review` — je to práca pre človeka,
-- nie neutrálny stav. Starý systém ju nechával ležať bez dôvodu.
update public.bank_transactions
   set review_reason = 'no_match'
 where status = 'needs_review' and review_reason is null;

update public.bank_transactions
   set vs_normalized = lpad(regexp_replace(variable_symbol, '\D', '', 'g'), 10, '0')
 where vs_normalized is null
   and variable_symbol is not null
   and regexp_replace(variable_symbol, '\D', '', 'g') <> '';

alter table public.bank_transactions alter column booked_at set not null;
alter table public.bank_transactions alter column status set not null;
alter table public.bank_transactions alter column status set default 'received';

do $$ begin
  alter table public.bank_transactions
    add constraint bank_transactions_status_check check (
      status in ('received', 'parsed', 'matched', 'needs_review', 'ignored', 'parse_error', 'duplicate')
    );
exception when duplicate_object then null;
end $$;

-- Staré stĺpce odchádzajú. `match_status` vedel tri hodnoty a nerozlíšil
-- „čaká na parsovanie" od „nedá sa spárovať", `booked_on` bol dátum bez času.
alter table public.bank_transactions drop column if exists match_status;
alter table public.bank_transactions drop column if exists booked_on;

drop index if exists public.bank_transactions_status_idx;
drop index if exists public.bank_transactions_account_idx;

create index if not exists bank_transactions_status_idx
  on public.bank_transactions (status, booked_at desc);
create index if not exists bank_transactions_account_idx
  on public.bank_transactions (account_id, booked_at desc);
create index if not exists bank_transactions_vs_idx
  on public.bank_transactions (vs_normalized) where vs_normalized is not null;
create index if not exists bank_transactions_provider_tx_idx
  on public.bank_transactions (provider_tx_id) where provider_tx_id is not null;
create index if not exists bank_transactions_statement_idx
  on public.bank_transactions (statement_id) where statement_id is not null;
-- Nedokončená práca: čo čaká na spárovanie a čo na človeka.
create index if not exists bank_transactions_cakajuce_idx
  on public.bank_transactions (received_at desc)
  where status in ('received', 'parsed', 'needs_review');

comment on column public.bank_transactions.status is
  'received → parsed → matched | needs_review | ignored | duplicate; parse_error pri chybe zdroja.';
comment on column public.bank_transactions.review_reason is
  'Prečo to nejde samo: underpaid, overpaid, already_paid, seats_unavailable, '
  'reservation_cancelled, ambiguous_vs, no_vs, no_match, dkim_fail.';
comment on column public.bank_transactions.vs_normalized is
  'VS doplnený nulami zľava na 10 znakov. `variable_symbol` je hodnota tak, ako prišla.';
comment on column public.bank_transactions.raw_payload_enc is
  'Šifrovaný originál zo zdroja. Maže ho retencia — obsahuje čísla kariet a osobné údaje.';
