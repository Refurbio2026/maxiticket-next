-- Párovanie bankových výpisov, 3. časť: rozhodnutia, pravidlá, audit a behy úloh.
--
-- Párovanie je čistá funkcia `paruj(transakcia, kandidáti, pravidlá)`. Tu sú
-- tri veci, ktoré k nej patria v databáze: kam sa zapíše rozhodnutie aj
-- s dôvodom (`transaction_matches`), čím sa dá riadiť poradie a konštanty
-- (`matching_rules`) a kto čo ručne zmenil (`audit_log`).

-- --- Rozhodnutie o transakcii -------------------------------------------
-- Starý systém dôvod nikde nedržal: platba buď mala nájomcu, alebo nie,
-- a prečo sa vedelo len z logu, ak vôbec. Tu má každá transakcia záznam,
-- podľa ktorého sa dá spätne povedať, ktoré pravidlo rozhodlo a s akým
-- rozdielom sumy.

create table if not exists public.transaction_matches (
  id uuid primary key default gen_random_uuid(),
  transaction_id uuid not null references public.bank_transactions (id) on delete cascade,
  order_id uuid references public.orders (id) on delete set null,
  settlement_id uuid references public.settlements (id) on delete set null,
  rule_code text not null,
  decision text not null check (decision in ('matched', 'suggested', 'rejected', 'duplicate')),
  expected_amount numeric(14, 2),
  paid_amount numeric(14, 2),
  -- Kladný = preplatok, záporný = nedoplatok.
  difference numeric(14, 2),
  confidence numeric(3, 2) not null default 1.00 check (confidence >= 0 and confidence <= 1),
  decided_by text not null default 'system' check (decided_by in ('system', 'user')),
  decided_by_user uuid references auth.users (id) on delete set null,
  decided_at timestamptz not null default now(),
  note text
);

create index if not exists transaction_matches_tx_idx
  on public.transaction_matches (transaction_id, decided_at desc);
create index if not exists transaction_matches_order_idx
  on public.transaction_matches (order_id) where order_id is not null;
create index if not exists transaction_matches_settlement_idx
  on public.transaction_matches (settlement_id) where settlement_id is not null;

-- Na transakciu smie byť najviac jedno platné spárovanie. Návrhy
-- (`suggested`) ani zamietnutia sa neobmedzujú — tých môže byť viac a sú to
-- história rozhodovania.
create unique index if not exists transaction_matches_jedno_matched
  on public.transaction_matches (transaction_id) where decision = 'matched';

-- --- Pravidlá -----------------------------------------------------------
-- Poradie, zapnutie, tolerancie a konštanty. Samotné podmienky sú
-- pomenované funkcie v kóde (`rule_code`) — zámerne to nie je podmienka
-- zapísaná v JSON, ktorú by nikto nevedel odladiť ani otestovať.
--
-- Platí „prvé zhodné pravidlo vyhráva". Starý systém návrh typu prepisoval
-- desiatimi pravidlami za sebou, takže výsledok závisel od posledného, ktoré
-- sa trafilo, a nedal sa vysvetliť.

create table if not exists public.matching_rules (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (scope in ('operational', 'accounting')),
  rule_code text not null,
  priority integer not null,
  enabled boolean not null default true,
  -- Konštanty pravidla. Starý systém ich mal roztrúsené v kóde (0,20; 3,10;
  -- 2,50; 5 %) a nikto nevedel, odkedy ktorá platí.
  params jsonb not null default '{}'::jsonb,
  tolerance numeric(14, 2) not null default 0,
  valid_from date,
  valid_to date,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (valid_to is null or valid_from is null or valid_to >= valid_from)
);

create unique index if not exists matching_rules_kod_key
  on public.matching_rules (scope, rule_code, coalesce(valid_from, '0001-01-01'::date));
create index if not exists matching_rules_poradie_idx
  on public.matching_rules (scope, priority) where enabled;

drop trigger if exists trg_matching_rules_updated_at on public.matching_rules;
create trigger trg_matching_rules_updated_at
  before update on public.matching_rules
  for each row execute function public.update_updated_at_column();

insert into public.matching_rules (scope, rule_code, priority, params, tolerance, note) values
  ('operational', 'duplicate_source', 10, '{}'::jsonb, 0,
   'Tá istá platba z druhého zdroja (účet, dátum, suma, VS, protiúčet).'),
  ('operational', 'refund_confirmed', 20, '{}'::jsonb, 0.01,
   'Odchádzajúca platba, ktorá zodpovedá vyexportovanej úlohe na vrátenie.'),
  ('operational', 'chargeback', 30, '{}'::jsonb, 0.01,
   'Záporná suma s ID transakcie prijatej platby — karta si vzala peniaze späť.'),
  ('operational', 'expense_text', 40,
   jsonb_build_object('texts', jsonb_build_array(
     'poplatok za vedenie', 'vedenie konta', 'zmluva o pozicke',
     'peniaze prijate systemom', 'dtpoplatok pos'
   )), 0,
   'Bankový poplatok alebo výplata — nie je to platba za vstupenky.'),
  ('operational', 'settlement_payout', 50, '{}'::jsonb, 0.01,
   'Odchádzajúca výplata organizátorovi podľa VS vyúčtovacieho protokolu.'),
  ('operational', 'vs_exact', 60, '{}'::jsonb, 0,
   'VS sedí na objednávku, suma aj mena presne. Jediné pravidlo, ktoré dokončí objednávku samo.'),
  ('operational', 'vs_overpaid', 70,
   jsonb_build_object('keep_limit', 1.00), 0,
   'Preplatok: objednávka sa dokončí. Rozdiel do `keep_limit` sa ponechá a zaúčtuje, '
   'väčší ide do fronty na vrátenie.'),
  ('operational', 'vs_underpaid', 80, '{}'::jsonb, 0,
   'Nedoplatok: objednávka sa NEDOKONČÍ. Vstupenky sa nevydajú za nezaplatenú sumu.'),
  ('operational', 'vs_already_paid', 90, '{}'::jsonb, 0,
   'Objednávka je zaplatená inou platbou — prijali sme peniaze druhýkrát.'),
  ('operational', 'vs_seats_unavailable', 100, '{}'::jsonb, 0,
   'Objednávka vypršala a sedadlá sú medzitým predané inému.'),
  ('operational', 'vs_cancelled', 110, '{}'::jsonb, 0,
   'Platba na zrušenú objednávku alebo rezerváciu po lehote.'),
  ('operational', 'vs_from_description', 120,
   jsonb_build_object('confidence', 0.6), 0,
   'VS chýba, číslo sa našlo v popise. Potvrdzuje človek, nikdy sa nedokončí samo.'),
  ('operational', 'no_match', 999, '{}'::jsonb, 0,
   'Nič nesedí — práca pre support.')
on conflict do nothing;

-- --- Auditný záznam -----------------------------------------------------
-- Každý ručný zásah do párovania: kto, kedy, čo bolo predtým a potom.
-- V starom systéme sa VS menil a platba označovala za náklad cez GET odkaz
-- bez akéhokoľvek záznamu.

create table if not exists public.audit_log (
  id uuid primary key default gen_random_uuid(),
  -- `on delete set null`: záznam prežije zmazanie účtu, rovnako ako
  -- poznámky k objednávkam.
  actor uuid references auth.users (id) on delete set null,
  action text not null,
  entity text not null,
  entity_id text not null,
  before jsonb,
  after jsonb,
  reason text,
  at timestamptz not null default now()
);

create index if not exists audit_log_entity_idx on public.audit_log (entity, entity_id, at desc);
create index if not exists audit_log_at_idx on public.audit_log (at desc);

-- --- Behy pravidelných úloh ---------------------------------------------
-- `system_heartbeats` hovorí len „naposledy zbehlo o…". Tu je každý beh
-- zvlášť aj s počtami a chybou, takže sa dá povedať, ktorý beh zlyhal a na čom.

create table if not exists public.job_runs (
  id uuid primary key default gen_random_uuid(),
  job text not null,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'ok', 'failed', 'timeout')),
  stats jsonb,
  error text
);

create index if not exists job_runs_job_idx on public.job_runs (job, started_at desc);

-- Práve bežiaci beh je na úlohu najviac jeden. Tento index je samotný zámok —
-- druhý súbežný pokus o vloženie na ňom spadne a funkcia nižšie vráti NULL.
create unique index if not exists job_runs_jeden_beziaci
  on public.job_runs (job) where status = 'running';

/*
 * Pokus o zabratie úlohy. Vráti id behu, alebo NULL, keď už beží.
 *
 * Zámok zámerne NIE JE `pg_try_advisory_lock`. Sedenie držíme cez pooler
 * a PostgREST, takže každé volanie beží v inej transakcii aj na inom spojení:
 * sedenie-ový advisory zámok by sa nikdy neuvoľnil a transakčný by padol
 * skôr, než by úloha v JavaScripte vôbec začala. Zámkom je preto riadok
 * s unikátnym indexom a lehotou.
 */
create or replace function public.start_job_run(p_job text, p_ttl_minutes integer default 30)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  -- Beh, ktorý spadol aj s procesom, by úlohu zablokoval navždy. Po lehote
  -- sa označí ako `timeout` a uvoľní miesto.
  update public.job_runs
     set status = 'timeout',
         finished_at = now(),
         error = coalesce(error, 'Beh neskončil do ' || p_ttl_minutes || ' minút.')
   where job = p_job
     and status = 'running'
     and started_at < now() - make_interval(mins => p_ttl_minutes);

  begin
    insert into public.job_runs (job) values (p_job) returning id into v_id;
  exception when unique_violation then
    return null;
  end;

  return v_id;
end;
$$;

create or replace function public.finish_job_run(
  p_id uuid,
  p_status text,
  p_stats jsonb default null,
  p_error text default null
)
returns void
language sql
security definer
set search_path = public
as $$
  update public.job_runs
     set status = case when p_status in ('ok', 'failed') then p_status else 'failed' end,
         finished_at = now(),
         stats = p_stats,
         error = p_error
   where id = p_id;
$$;

-- --- Prístupové práva ---------------------------------------------------

alter table public.transaction_matches enable row level security;
alter table public.matching_rules enable row level security;
alter table public.audit_log enable row level security;
alter table public.job_runs enable row level security;

drop policy if exists transaction_matches_admin on public.transaction_matches;
create policy transaction_matches_admin on public.transaction_matches
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists matching_rules_admin on public.matching_rules;
create policy matching_rules_admin on public.matching_rules
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

-- Audit sa smie čítať, ale nie prepisovať. Záznam, ktorý vie autor zmeniť,
-- nie je audit — zápis ide výhradne cez service role v serverových funkciách.
drop policy if exists audit_log_admin_read on public.audit_log;
create policy audit_log_admin_read on public.audit_log
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists job_runs_admin_read on public.job_runs;
create policy job_runs_admin_read on public.job_runs
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role));

grant select, insert, update, delete on public.transaction_matches to authenticated;
grant select, insert, update, delete on public.matching_rules to authenticated;
grant select on public.audit_log to authenticated;
grant select on public.job_runs to authenticated;
grant all on public.audit_log to service_role;
grant all on public.job_runs to service_role;

revoke all on function public.start_job_run(text, integer) from public, anon, authenticated;
revoke all on function public.finish_job_run(uuid, text, jsonb, text) from public, anon, authenticated;
grant execute on function public.start_job_run(text, integer) to service_role;
grant execute on function public.finish_job_run(uuid, text, jsonb, text) to service_role;
