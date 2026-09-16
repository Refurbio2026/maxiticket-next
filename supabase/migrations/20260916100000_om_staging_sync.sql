-- Inkrementálny sync vstupeniek zo starého systému (MaxiTicket OM4, MariaDB
-- `bt_tickets` na RDS) — staging vrstva. Špecifikácia: `docs/spec-ticket-sync.md`.
--
-- Tabuľky s prefixom `om_` sú **verná kópia zdroja**, nie náš dátový model.
-- Názvy stĺpcov sú preto verbatim z OM (`id_seat`, `id_plan`, `price`), aby sa
-- dalo ladiť proti zdroju bez prekladového slovníka. Premenované sú len tri
-- kolízie s rezervovanými slovami: `modified` → `modified_at`, `changed` →
-- `changed_at`, `start`/`end` → `start_time`/`end_time`.
--
-- Do zdrojovej DB sa **nikdy nezapisuje** — sync má read-only používateľa
-- (`eticketo_sync`) a zdroj nemá ani outbox, ani tombstony. Dôsledky, ktoré
-- z toho plynú, sú popísané pri jednotlivých tabuľkách.
--
-- Celý prefix je prístupný **iba cez service_role** (worker a serverové
-- funkcie). RLS je zapnutá a politiky zámerne žiadne nie sú — rovnako ako pri
-- `payment_credentials`. Sú tu osobné údaje a čiarové kódy vstupeniek.

-- --- Klasifikácia stavu miesta -------------------------------------------
-- Číselník `seat_status` má v OM 28 hodnôt a kanál A ich číta **všetky** —
-- filter na stav v zdrojovom dotaze by zneviditeľnil storno (prechod do stavu
-- 1). Preto sem chodia aj stavy, ktoré nie sú vstupenkou, a kategória má šesť
-- hodnôt, nie štyri:
--
--   sold     predaj, ráta sa do tržby
--   abo      permanentky — samostatná kategória, nemiešať s predajom
--   pending  rezervácie, ešte nie sú tržbou
--   blocked  blokované miesto (57 % všetkých zmien, nikdy nemá cenu)
--   free     voľné miesto — výsledok storna; bez tejto hodnoty sa storno
--            prejaví len zmiznutím z výberu, nie hodnotou
--   other    zvyšok číselníka a čokoľvek, čo v OM pribudne neskôr; bez nej
--            by upsert spadol na neznámom stave

do $$
begin
  if not exists (select 1 from pg_type where typname = 'om_ticket_category') then
    create type public.om_ticket_category as enum (
      'sold', 'abo', 'pending', 'blocked', 'free', 'other'
    );
  end if;
end
$$;

-- --- Číselník stavov ------------------------------------------------------
-- Zoznam stavov **nesmie byť natvrdo v kóde workera** (spec 3.1) — mapovanie
-- je konfigurovateľné aj v starom systéme. Zdrojom pravdy je tento riadok
-- v databáze: pribudne stav, doplní sa riadok, worker sa nenasadzuje.
--
-- Deľba práce pri dennom refreshi: OM stĺpce (`name`, `ticket`, `enabled`, …)
-- prepisuje refresh zo zdroja, `category` a `suspicious_when_free` sú **naše**
-- a refresh sa ich nedotkne. Neznámy nový stav dostane `category = 'other'`
-- a `category_source = 'auto'`, čo je fronta na ručné zaradenie.

create table if not exists public.om_seat_status (
  id_seat_status smallint primary key,
  name text,
  -- `ticket = 1` znamená „na toto miesto sa tlačí vstupenka". Ako filter
  -- syncu **nestačí** — stav 26 (predaná online permanentka) má `ticket = 0`.
  ticket boolean,
  enabled boolean,
  invoice boolean,
  customer boolean,
  mifare boolean,
  reservation boolean,
  order_position smallint,
  category public.om_ticket_category not null default 'other',
  -- Zapína pravidlo `suspicious` pre tento stav (dnes iba 15, pozri nižšie).
  suspicious_when_free boolean not null default false,
  category_source text not null default 'spec' check (category_source in ('spec', 'auto')),
  raw jsonb,
  synced_at timestamptz not null default now()
);

comment on table public.om_seat_status is
  'Číselník `seat_status` z OM. `category` a `suspicious_when_free` sú naše stĺpce, '
  'denný refresh zo zdroja ich neprepisuje.';
comment on column public.om_seat_status.category_source is
  '`spec` = zaradené podľa docs/spec-ticket-sync.md 3.1, `auto` = nový stav z OM, '
  'dostal ''other'' a čaká na ručné zaradenie.';

-- Naplnenie podľa spec 3.1. Názvy, ktoré špecifikácia neuvádza (stavy 5 a 14),
-- ostávajú NULL a doplní ich prvý denný refresh zo zdroja.
insert into public.om_seat_status (id_seat_status, name, ticket, enabled, category, suspicious_when_free) values
  -- Predaj (`ticket = 1`)
  (6,  'Predaj (pokladňa)',          true,  true,  'sold',    false),
  (7,  'Voľná vstupenka',            true,  true,  'sold',    false),
  (9,  'Predaj Skybox',              true,  false, 'sold',    false),
  (13, 'Direktor',                   true,  false, 'sold',    false),
  -- Stav 15 je celý podozrivý, pozri `om_tickets.suspicious`.
  (15, 'Externý predaj',             true,  true,  'sold',    true),
  (17, 'Predaný kontingent',         true,  false, 'sold',    false),
  (18, 'Organizátor',                true,  true,  'sold',    false),
  (19, 'Kommissionsverkauf',         true,  false, 'sold',    false),
  (21, 'Predaj rýchlej rezervácie',  true,  false, 'sold',    false),
  (23, 'Internetový predaj',         true,  true,  'sold',    false),
  (24, 'Voľné ABO',                  true,  false, 'sold',    false),
  (27, 'Online ABO mifare',          true,  true,  'sold',    false),
  (28, 'Predaj bez OP',              true,  false, 'sold',    false),
  -- Permanentky (`ticket = 0`, napriek tomu je to predaj)
  (5,  null,                         false, null,  'abo',     false),
  (14, null,                         false, null,  'abo',     false),
  (26, 'Online ABO',                 false, null,  'abo',     false),
  -- Rezervácie — nie sú tržba
  (11, 'Rezervácia',                 false, null,  'pending', false),
  (20, 'Rýchla rezervácia',          false, null,  'pending', false),
  -- Mimo predaja
  (2,  'Blokované sedadlo',          false, null,  'blocked', false),
  (1,  'Voľné sedadlo',              false, null,  'free',    false),
  -- Stav 25 nie je v explicitnom zozname spec 3.1 (v číselníku vypnutý, v dátach
  -- sa nevyskytuje), preto 'other' a nie 'pending'.
  (25, 'Internetová rezervácia',     false, false, 'other',   false)
on conflict (id_seat_status) do nothing;

-- --- Vstupenky (kanál A) --------------------------------------------------
-- Zdroj: `seat`, kurzor `(modified, id_seat)` s päťminútovým prekryvom.
-- `seat.modified` je `ON UPDATE current_timestamp()` s vlastným indexom, takže
-- je to **jediný úplný zdroj vstupeniek** — zachytí aj predaj mimo
-- `FinalizeOMSale` (pokladňa, externý predaj, partneri).
--
-- Riadok v `seat` **nie je predaj**, je to miesto v predstavení: vzniká už pri
-- založení termínu ako voľné miesto a pri predaji sa iba mení. Preto sa
-- vstupenky nikdy nečítajú cez `id_seat > lastId` a to isté `id_seat` môže byť
-- postupne predané, stornované a predané znovu.

create table if not exists public.om_tickets (
  id_seat bigint primary key,
  id_plan bigint not null,
  id_theater_seat bigint,
  id_seat_status smallint not null,
  -- Bez cudzieho kľúča na `om_orders`: hlavička objednávky môže doraziť neskôr
  -- alebo vôbec — 36,7 % predaja ju v OM nemá (pokladňa, externý predaj).
  id_seat_note bigint,
  id_invoice bigint,
  id_person bigint,
  id_person2 bigint,
  price numeric(12, 2),
  discount numeric(12, 2),
  system_cost numeric(12, 2),
  id_discount bigint,
  id_discount2 bigint,
  id_payment bigint,
  id_expenses bigint,
  barcode bigint,
  scan integer not null default 0,
  id_seat_category bigint,
  id_reservation bigint,
  id_sys_user bigint,
  changed_at timestamptz,
  modified_at timestamptz not null,
  category public.om_ticket_category not null default 'other',
  suspicious boolean not null default false,
  synthetic_order_key text,
  vanished_at timestamptz,
  raw jsonb not null,
  first_seen_at timestamptz not null default now(),
  synced_at timestamptz not null default now()
);

comment on column public.om_tickets.id_seat is
  'PK v OM, NIE identifikátor predaja. Po storne sa miesto vráti do stavu 1 '
  'a ten istý riadok sa môže predať znovu — históriu drží om_storno_log a om_seat_history.';
comment on column public.om_tickets.id_payment is
  'Pozor: pri dokončení rezervácie z bankového výpisu sem OM zapíše ID bankového účtu, '
  'nie ID z `payment` (app/models/Superadmin/UnprocessedPayments.php:365).';
comment on column public.om_tickets.barcode is
  'Pri storne sa v OM zvýši o 1, takže to nie je stabilný kľúč. Pôvodnú hodnotu '
  'drží om_storno_log.barcode — cez ňu sa dopárujú historické skeny.';
comment on column public.om_tickets.scan is
  'Počítadlo kontrol vstupu, nie čas. Zdrojom pravdy je om_scans; `scan > 0` slúži '
  'len na kontrolu konzistencie.';
comment on column public.om_tickets.changed_at is
  'Nespoľahlivé ako kurzor (storno ani sken ho nemenia). Pri predaji bez hlavičky '
  'objednávky je to však jediný čas predaja, ktorý existuje — vstupuje do synthetic_order_key.';
comment on column public.om_tickets.suspicious is
  'Stav 15 „Externý predaj" s nulovou cenou a bez hlavičky. Triton.php:657 tam zapisuje '
  'konštantu SEAT_STORNO pri zrušení rezervácie z turniketu, takže to takmer isto nie je '
  'predaj — do tržby sa nerát a čaká na potvrdenie prevádzkou (spec 9.2).';
comment on column public.om_tickets.synthetic_order_key is
  'Odvodená objednávka pre predaj bez `seat_note` (36,7 %). Počíta sa RAZ, pri prvom '
  'videní vstupenky, a už nikdy — `changed_at` sa môže posunúť a objednávka by sa '
  'rozpadla na dve. Stráži to trigger.';
comment on column public.om_tickets.vanished_at is
  'Riadok v zdroji už nie je. `seat` má FK na `plan` s ON DELETE CASCADE, takže zrušenie '
  'predstavenia zmaže miesta ticho — odhalí to až hodinová kontrola počtov.';

create index if not exists om_tickets_plan_status_idx on public.om_tickets (id_plan, id_seat_status);
create index if not exists om_tickets_modified_idx on public.om_tickets (modified_at desc);
-- Skeny sa párujú cez (plán, čiarový kód) — `seat_scan.id_seat` je v OM vždy NULL.
create index if not exists om_tickets_plan_barcode_idx on public.om_tickets (id_plan, barcode);
create index if not exists om_tickets_seat_note_idx on public.om_tickets (id_seat_note)
  where id_seat_note is not null;
-- Tržbové prehľady bez čítania blokovaných miest, ktoré tvoria väčšinu riadkov.
create index if not exists om_tickets_predane_idx on public.om_tickets (id_plan)
  where category = 'sold'::public.om_ticket_category;
create index if not exists om_tickets_suspicious_idx on public.om_tickets (id_plan)
  where suspicious;
create index if not exists om_tickets_order_key_idx on public.om_tickets (synthetic_order_key)
  where synthetic_order_key is not null;

-- Klasifikácia je v databáze, nie vo workeri — worker posiela surový riadok
-- a nemusí o stavoch vedieť nič. Zároveň to znamená, že kategóriu nemôže
-- pokaziť žiadna iná cesta zápisu.
create or replace function public.om_klasifikuj_vstupenku()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  v_category public.om_ticket_category;
  v_suspicious_when_free boolean;
begin
  select s.category, s.suspicious_when_free
    into v_category, v_suspicious_when_free
    from public.om_seat_status s
   where s.id_seat_status = new.id_seat_status;

  -- Stav, ktorý číselník nepozná, nesmie zhodiť dávku.
  new.category := coalesce(v_category, 'other');
  new.suspicious := coalesce(v_suspicious_when_free, false)
                    and coalesce(new.price, 0) = 0
                    and new.id_seat_note is null;
  new.synced_at := now();

  if tg_op = 'UPDATE' then
    -- Obe hodnoty sa nastavujú raz a už sa nemenia.
    new.first_seen_at := old.first_seen_at;
    new.synthetic_order_key := coalesce(old.synthetic_order_key, new.synthetic_order_key);
  end if;

  return new;
end;
$$;

create or replace trigger om_tickets_klasifikacia
  before insert or update on public.om_tickets
  for each row execute function public.om_klasifikuj_vstupenku();

-- --- Osobné údaje (kanál B) -----------------------------------------------
-- Oddelene od objednávok, aby sa dali mazať a obmedzovať samostatne.
-- `seat_note.ip_address` a `seat_note_refund.iban` sa **neprenášajú vôbec** —
-- na prechod nie sú potrebné a je to najlacnejší spôsob, ako ich nemať.
-- `person` v OM nemá žiadnu časovú značku, preto sa riadky dopĺňajú adresne
-- podľa `id_person` z práve načítaných objednávok, nie vlastným kanálom.

create table if not exists public.om_persons (
  id_person bigint primary key,
  name text,
  surname text,
  email text,
  phone text,
  raw jsonb,
  synced_at timestamptz not null default now()
);

create index if not exists om_persons_email_idx on public.om_persons (lower(email))
  where email is not null;

comment on table public.om_persons is
  'Osobné údaje zákazníkov z OM `person`. Zdroj nemá časovú značku — riadky sa '
  'dopĺňajú adresne podľa id_person z kanála B.';

-- --- Hlavičky objednávok (kanál B) ----------------------------------------
-- Zdroj: `seat_note` (kurzor `id_seat_note`, prekryv 500) obohatené o
-- `invoice`, `person` a `mt_payments.basket.ts`.
--
-- Kanál **iba obohacuje** vstupenky z kanála A. Vstupenka bez objednávky je
-- platný a bežný stav, nie chyba syncu: hlavičku nemá 36,7 % predaja — celý
-- externý predaj, voľné vstupenky a 71 % pokladničného. Pre tie sa objednávka
-- odvodzuje zo `seat` cez `om_tickets.synthetic_order_key`.

create table if not exists public.om_orders (
  id_seat_note bigint primary key,
  vs text,
  id_basket bigint,
  referral text,
  id_affiliate bigint,
  -- Jediný spoľahlivý čas objednávky. `seat_note` časovú značku nemá vôbec,
  -- preto sa berie z inej databázy (`mt_payments.basket.ts`).
  ordered_at timestamptz,
  id_invoice bigint,
  paid_at timestamptz,
  -- `invoice.changed` sa nastavuje len pri vzniku, žiadny UPDATE ho neprepisuje.
  invoice_created_at timestamptz,
  is_reservation boolean,
  total numeric(12, 2),
  price numeric(12, 2),
  discount numeric(12, 2),
  order_number text,
  invoice_year integer,
  invoice_number integer,
  reservation_reminder timestamptz,
  reservation_cancel timestamptz,
  id_person bigint,
  raw jsonb not null,
  synced_at timestamptz not null default now()
);

comment on column public.om_orders.id_invoice is
  'Faktúra vzniká len pri fakturácii, rezervácii alebo doručení — 99,7 % online predaja '
  'ju nemá a pokladničný ani externý nikdy. `invoice` teda nie je nositeľom objednávky.';
comment on column public.om_orders.invoice_number is
  'Sekvencia v rámci roka (`max + 1`), nie auto_increment — nie je zaručene súvislá.';

create index if not exists om_orders_basket_idx on public.om_orders (id_basket)
  where id_basket is not null;
create index if not exists om_orders_invoice_idx on public.om_orders (id_invoice)
  where id_invoice is not null;
create index if not exists om_orders_person_idx on public.om_orders (id_person)
  where id_person is not null;
create index if not exists om_orders_ordered_idx on public.om_orders (ordered_at desc);

-- --- Storná (kanál C1) ----------------------------------------------------
-- Zdroj: `storno_seat_log`, kurzor `id_storno_seat_log`.
--
-- Kanál A povie, že miesto je zrazu voľné. Táto tabuľka povie prečo, kedy
-- a kto. Je nutná **aj popri `seat_history`**: storno pre organizátora
-- zapisuje iba sem a do histórie vôbec nejde.

create table if not exists public.om_storno_log (
  id_storno_seat_log bigint primary key,
  id_seat bigint,
  id_seat_status smallint,
  id_sys_user bigint,
  id_person bigint,
  id_person2 bigint,
  id_discount bigint,
  id_discount2 bigint,
  id_invoice bigint,
  id_reservation bigint,
  id_seat_note bigint,
  id_payment bigint,
  id_expenses bigint,
  mifare text,
  id_mifare bigint,
  price numeric(12, 2),
  discount numeric(12, 2),
  printed smallint,
  -- Čiarový kód spred storna. Po storne sa `seat.barcode` zvýši o 1, takže
  -- toto je jediná cesta, ako dopárovať sken vykonaný pred stornom.
  barcode bigint,
  log_user_id bigint,
  created_at timestamptz,
  raw jsonb not null,
  synced_at timestamptz not null default now()
);

comment on column public.om_storno_log.created_at is
  'Jediný spoľahlivý čas storna (DB default v zdroji, kód ho nevkladá).';

create index if not exists om_storno_log_seat_idx on public.om_storno_log (id_seat, created_at desc);
create index if not exists om_storno_log_barcode_idx on public.om_storno_log (barcode)
  where barcode is not null;
create index if not exists om_storno_log_created_idx on public.om_storno_log (created_at desc);

-- --- História zmien miesta (kanál C2) -------------------------------------
-- Zdroj: `seat_history`, kurzor `id_seat_history`. Zachytáva zmeny ceny
-- a storná cez superadmin.

create table if not exists public.om_seat_history (
  id_seat_history bigint primary key,
  id_seat bigint,
  id_plan bigint,
  id_seat_note bigint,
  id_seat_status smallint,
  price numeric(12, 2),
  discount numeric(12, 2),
  id_invoice bigint,
  id_payment bigint,
  -- Kód zapisuje vždy 1, pri čítaní sa vylučujú 0, 3, 4. Význam hodnôt je
  -- v OM neoverený (telo procedúry `UpdateSeatRC` nie je v repozitári).
  operation_type smallint,
  id_storno_user bigint,
  barcode bigint,
  original_changed timestamptz,
  raw jsonb not null,
  synced_at timestamptz not null default now()
);

comment on column public.om_seat_history.original_changed is
  'Kópia `seat.changed`, NIE čas vzniku riadku histórie. Preto ten názov — čas udalosti '
  'ber z om_storno_log.created_at, prípadne z om_tickets.modified_at.';

create index if not exists om_seat_history_seat_idx
  on public.om_seat_history (id_seat, id_seat_history desc);
create index if not exists om_seat_history_plan_idx on public.om_seat_history (id_plan);

-- --- Refundy (kanál C3) ---------------------------------------------------
-- Zdroj: `seat_note_refund`. Kurzor je hybridný — `id > lastId` OR
-- `date_refund/date_refund_email >= since` — lebo refund sa vybavuje UPDATE-om
-- existujúceho riadku, ktorý by čistý ID-kurzor už nikdy nezachytil.
--
-- `iban` sa zámerne neprenáša. `seat_refund` (riadok na miesto) sa
-- nesynchronizuje vôbec — jeho `changed` je len kópia `seat.changed`
-- a väzba miesto → refund sa zloží cez `id_seat_note`.

create table if not exists public.om_refunds (
  id_seat_note_refund bigint primary key,
  id_seat_note bigint,
  id_plan bigint,
  date_request timestamptz,
  days_to_refund integer,
  processed smallint,
  id_sys_user bigint,
  date_refund timestamptz,
  date_refund_email timestamptz,
  raw jsonb not null,
  synced_at timestamptz not null default now()
);

create index if not exists om_refunds_seat_note_idx on public.om_refunds (id_seat_note);
create index if not exists om_refunds_refunded_idx on public.om_refunds (date_refund desc)
  where date_refund is not null;

-- --- Kontrola vstupu (kanál D) --------------------------------------------
-- Zdroj: `seat_scan`, kurzor `id_seat_scan`. Prekryv nie je potrebný: aj
-- offline dávka nahraná so spätným časom dostane nové, vyššie ID.

create table if not exists public.om_scans (
  id_seat_scan bigint primary key,
  id_plan bigint,
  id_gate bigint,
  barcode bigint,
  -- 0 = sken, 1 = zrušenie skenu.
  scan_type smallint,
  -- 1 = online, 0 = offline dávka nahraná neskôr.
  online smallint,
  scan_time timestamptz not null,
  source_id_seat bigint,
  matched_id_seat bigint,
  unmatched_reason text check (unmatched_reason in ('no_seat', 'barcode_rotated')),
  raw jsonb not null,
  synced_at timestamptz not null default now()
);

comment on column public.om_scans.scan_time is
  'Čas udalosti, NIE poradie doručenia. Stav vstupenky sa počíta v poradí podľa '
  'scan_time, nie podľa id_seat_scan — offline dávka príde s vyšším ID, ale starším časom.';
comment on column public.om_scans.source_id_seat is
  'V OM je vždy NULL — väzba na vstupenku existuje len cez (id_plan, barcode). '
  'Držíme ho, aby bolo vidieť, že to tak naozaj je.';
comment on column public.om_scans.matched_id_seat is
  'Dopárované v cieli. JOIN do zdroja sa nerobí: index na `seat_scan` je (id_gate, barcode), '
  'takže párovanie cez id_plan by čítalo tabuľku bez indexu.';

-- Kľúčový index — nad ním beží výpočet stavu vstupenky v tickets_unified.
create index if not exists om_scans_plan_barcode_time_idx
  on public.om_scans (id_plan, barcode, scan_time desc, id_seat_scan desc);
create index if not exists om_scans_matched_idx on public.om_scans (matched_id_seat)
  where matched_id_seat is not null;
create index if not exists om_scans_time_idx on public.om_scans (scan_time desc);
create index if not exists om_scans_nesparovane_idx on public.om_scans (id_plan)
  where matched_id_seat is null;

-- --- Podujatia (kanál E) --------------------------------------------------
-- Zdroj: `plan`, kurzor `modified`.
--
-- DDL overené na prod RDS 16. 9. 2026: `modified datetime NOT NULL DEFAULT
-- current_timestamp() ON UPDATE current_timestamp()` s vlastným indexom
-- `modified`. Kurzor kanála E je teda čisto `modified` a ide po indexe.
--
-- `drama`, `hall_desc` a `promoter` nemajú v OM **žiadnu** časovú značku,
-- preto sa ich názvy denormalizujú sem pri každej zmene plánu a raz denne
-- plným refreshom. Premenovanie podujatia sa tak prejaví najneskôr v noci —
-- je to známe obmedzenie, nie chyba.

create table if not exists public.om_events (
  id_plan bigint primary key,
  id_drama bigint,
  id_hall_desc bigint,
  id_price_category bigint,
  id_promoter bigint,
  id_promoter_ticket bigint,
  id_subdomain bigint,
  id_plan_group bigint,
  id_performer bigint,
  datum date,
  -- `plan.start` a `plan.end` sú v OM typu `time`, nie `datetime` — dátum nesie
  -- samostatný stĺpec `datum`. Preto tu nie je timestamptz.
  start_time time,
  end_time time,
  door_time timestamptz,
  sell_start timestamptz,
  sell_end timestamptz,
  stop_sell smallint,
  show_online smallint,
  show_hash bigint,
  allow_remote smallint,
  allow_export smallint,
  require_access_code smallint,
  abo_mask smallint,
  ticket_limit integer,
  vat numeric(5, 2),
  tickets_with_places smallint,
  created_at timestamptz,
  modified_at timestamptz,
  -- Kurzor kanála E je `modified_at` — na prod RDS je NOT NULL s ON UPDATE
  -- a vlastným indexom. COALESCE tu ostáva len ako defenzíva: keby sa niekedy
  -- čítalo z nájomcu so starším DDL (nullable `modified`), kurzor nepreskočí
  -- plány bez úpravy. Za normálnych okolností sa rovná `modified_at`.
  modified_effective timestamptz generated always as (coalesce(modified_at, created_at)) stored,
  drama_name text,
  hall_name text,
  promoter_name text,
  -- Plán zmizol zo zdroja — kontrola počtov ho označí aj s jeho vstupenkami.
  cancelled_at timestamptz,
  raw jsonb not null,
  synced_at timestamptz not null default now()
);

comment on column public.om_events.show_online is
  'Hodnoty 0, 6, 7 — význam je v OM neoverený (spec 9.2).';

create index if not exists om_events_cursor_idx on public.om_events (modified_effective);
create index if not exists om_events_datum_idx on public.om_events (datum);
create index if not exists om_events_drama_idx on public.om_events (id_drama);
create index if not exists om_events_zrusene_idx on public.om_events (cancelled_at)
  where cancelled_at is not null;

-- --- Kurzory --------------------------------------------------------------
-- Kurzory sa držia výhradne tu, v cieli — zdrojová DB sa nemení a sync do nej
-- nesmie zapisovať. Kanál C má tri riadky, lebo sú to tri nezávislé tabuľky
-- s tromi nezávislými kurzormi; do jedného čísla sa stlačiť nedajú.
--
-- `cursor_value` je jsonb, lebo kurzory nemajú rovnaký tvar:
--   A          {"modified": "2026-09-16T10:00:00Z", "id_seat": 1980237}
--   B,C1,C2,C3 {"last_id": 123456}
--   D          {"last_id": 824913}
--   E          {"ts": "2026-09-16T10:00:00Z"}
--   codebooks  {"refreshed_at": "…"}
--   counts     {"checked_at": "…"}

create table if not exists public.om_sync_cursor (
  channel text primary key check (
    channel in ('A', 'B', 'C1', 'C2', 'C3', 'D', 'E', 'codebooks', 'counts')
  ),
  cursor_value jsonb not null default '{}'::jsonb,
  last_run_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  -- Počet riadkov posledného behu, nie kumulatívne.
  rows_processed bigint not null default 0
);

comment on table public.om_sync_cursor is
  'Zámok proti súbehu tu nie je — worker používa `job_runs` (job = `om-sync-<kanál>`) '
  'a jeho unique index job_runs_jeden_beziaci.';

insert into public.om_sync_cursor (channel) values
  ('A'), ('B'), ('C1'), ('C2'), ('C3'), ('D'), ('E'), ('codebooks'), ('counts')
on conflict (channel) do nothing;

-- --- Kontrola počtov ------------------------------------------------------
-- `seat.modified` pokryje každú zmenu riadku, nie však jeho zmazanie. Keďže
-- `seat` má FK na `plan` s ON DELETE CASCADE, zrušenie predstavenia zmaže
-- miesta ticho a v zdroji po nich neostane žiadna stopa. Hodinová agregácia
-- nad aktívnymi termínmi je jediné, čo to odhalí.
--
-- Blokované miesta, permanentky a voľné sa rátajú **zvlášť**. Keby sa blokované
-- zliali s voľnými, zmena kapacity sály by vyzerala ako výpadok dát.

create table if not exists public.om_reconcile_log (
  id uuid primary key default gen_random_uuid(),
  id_plan bigint not null,
  checked_at timestamptz not null default now(),
  status text not null check (status in ('ok', 'mismatch', 'plan_missing', 'repaired')),
  source_counts jsonb,
  target_counts jsonb,
  -- Len kľúče, ktoré nesedia, aj s oboma hodnotami.
  diff jsonb,
  rows_refetched integer,
  repaired_at timestamptz,
  error text
);

create index if not exists om_reconcile_log_plan_idx
  on public.om_reconcile_log (id_plan, checked_at desc);
create index if not exists om_reconcile_log_nezhody_idx
  on public.om_reconcile_log (checked_at desc) where status <> 'ok';

-- --- Prístup --------------------------------------------------------------
-- Iba service_role, teda worker a serverové funkcie. RLS je zapnutá a politiky
-- zámerne žiadne nie sú — rovnako ako pri `payment_credentials`. Sú tu osobné
-- údaje a čiarové kódy vstupeniek, takže sa k tabuľkám nesmie dostať ani
-- prihlásený admin priamo cez API.

alter table public.om_seat_status enable row level security;
alter table public.om_tickets enable row level security;
alter table public.om_persons enable row level security;
alter table public.om_orders enable row level security;
alter table public.om_storno_log enable row level security;
alter table public.om_seat_history enable row level security;
alter table public.om_refunds enable row level security;
alter table public.om_scans enable row level security;
alter table public.om_events enable row level security;
alter table public.om_sync_cursor enable row level security;
alter table public.om_reconcile_log enable row level security;

revoke all on table public.om_seat_status from anon, authenticated;
revoke all on table public.om_tickets from anon, authenticated;
revoke all on table public.om_persons from anon, authenticated;
revoke all on table public.om_orders from anon, authenticated;
revoke all on table public.om_storno_log from anon, authenticated;
revoke all on table public.om_seat_history from anon, authenticated;
revoke all on table public.om_refunds from anon, authenticated;
revoke all on table public.om_scans from anon, authenticated;
revoke all on table public.om_events from anon, authenticated;
revoke all on table public.om_sync_cursor from anon, authenticated;
revoke all on table public.om_reconcile_log from anon, authenticated;

grant all on table public.om_seat_status to service_role;
grant all on table public.om_tickets to service_role;
grant all on table public.om_persons to service_role;
grant all on table public.om_orders to service_role;
grant all on table public.om_storno_log to service_role;
grant all on table public.om_seat_history to service_role;
grant all on table public.om_refunds to service_role;
grant all on table public.om_scans to service_role;
grant all on table public.om_events to service_role;
grant all on table public.om_sync_cursor to service_role;
grant all on table public.om_reconcile_log to service_role;
