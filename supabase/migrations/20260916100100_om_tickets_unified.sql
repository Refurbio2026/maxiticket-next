-- Zjednotenie vstupeniek zo starého systému a našich — pohľad pre skenovanie
-- a prehľady. Nadväzuje na `20260916100000_om_staging_sync.sql`.
--
-- Okrem view sú tu dve funkcie, ktoré potrebuje worker: dopárovanie skenov
-- a počty pre hodinovú kontrolu. Obe sú čisté JOIN-y nad indexmi, ktoré už
-- existujú — ťahať ich do JavaScriptu by znamenalo dva dotazy a mapu v pamäti
-- pre nič.

-- --- Stav skenu v OM ------------------------------------------------------
-- `seat.scan` je len počítadlo. Zdrojom pravdy je `om_scans` a stav sa počíta
-- **v poradí `scan_time`, nie podľa `id_seat_scan`**: offline dávka nahraná
-- o hodinu neskôr dostane vyššie id, ale starší čas udalosti. Keby sa
-- rozhodovalo podľa id, zrušenie skenu z brány by prebilo neskorší platný
-- sken nahraný z offline dávky.
--
-- `id_seat_scan desc` je len rozhodovač pri zhodnom `scan_time` (celá offline
-- dávka má často rovnakú sekundu).

create or replace view public.om_posledny_sken
with (security_invoker = true) as
select distinct on (s.id_plan, s.barcode)
       s.id_plan,
       s.barcode,
       s.scan_type,
       s.scan_time,
       s.id_gate,
       s.online
  from public.om_scans s
 where s.barcode is not null
 order by s.id_plan, s.barcode, s.scan_time desc, s.id_seat_scan desc;

comment on view public.om_posledny_sken is
  'Posledná skenovacia udalosť na (plán, čiarový kód) podľa času udalosti. '
  'scan_type 0 = vstupenka je skontrolovaná, 1 = sken bol zrušený.';

-- --- Dopárovanie skenov ---------------------------------------------------
-- `seat_scan.id_seat` je v OM vždy NULL, väzba existuje len cez
-- (`id_plan`, `barcode`). Po storne sa `seat.barcode` zvýši o 1, takže
-- historický sken sa na aktuálnu vstupenku už nespáruje — dohľadá sa cez
-- `om_storno_log.barcode`, kde je hodnota spred storna.

create or replace function public.om_doparuj_skeny(p_limit integer default 50000)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_priame integer;
  v_cez_storno integer;
  v_bez_vazby integer;
begin
  -- 1) Priame dopárovanie na aktuálny čiarový kód.
  with kandidati as (
    select s.id_seat_scan, t.id_seat
      from public.om_scans s
      join public.om_tickets t
        on t.id_plan = s.id_plan and t.barcode = s.barcode
     where s.matched_id_seat is null
     limit p_limit
  )
  update public.om_scans s
     set matched_id_seat = k.id_seat, unmatched_reason = null
    from kandidati k
   where s.id_seat_scan = k.id_seat_scan;
  get diagnostics v_priame = row_count;

  -- 2) Sken spred storna — čiarový kód sa medzitým posunul.
  with kandidati as (
    select distinct on (s.id_seat_scan) s.id_seat_scan, l.id_seat
      from public.om_scans s
      join public.om_storno_log l on l.barcode = s.barcode
      join public.om_tickets t on t.id_seat = l.id_seat and t.id_plan = s.id_plan
     where s.matched_id_seat is null
     order by s.id_seat_scan, l.created_at desc
     limit p_limit
  )
  update public.om_scans s
     set matched_id_seat = k.id_seat, unmatched_reason = 'barcode_rotated'
    from kandidati k
   where s.id_seat_scan = k.id_seat_scan;
  get diagnostics v_cez_storno = row_count;

  -- 3) Zvyšok: vstupenka k skenu neexistuje. Nie je to nutne chyba — plán
  --    mohol byť zrušený (kaskáda) alebo ešte nedorazil kanálom A.
  update public.om_scans s
     set unmatched_reason = 'no_seat'
   where s.matched_id_seat is null
     and s.unmatched_reason is distinct from 'no_seat';
  get diagnostics v_bez_vazby = row_count;

  return jsonb_build_object(
    'priame', v_priame,
    'cez_storno', v_cez_storno,
    'bez_vazby', v_bez_vazby
  );
end;
$$;

revoke all on function public.om_doparuj_skeny(integer) from public, anon, authenticated;
grant execute on function public.om_doparuj_skeny(integer) to service_role;

-- --- Počty pre kontrolu ---------------------------------------------------
-- Zrkadlo agregácie, ktorú worker púšťa nad zdrojom. Kategórie musia sedieť
-- s tými v `om_seat_status`, preto sa počíta z `category`, nie z vymenovaných
-- stavov — zmena zaradenia stavu sa tak prejaví na oboch stranách naraz.
--
-- Zmiznuté miesta (`vanished_at`) sa nerátajú, inak by plán po zrušení navždy
-- hlásil nezhodu.

create or replace function public.om_pocty_podla_planu(p_plany bigint[])
returns table (
  id_plan bigint,
  seats bigint,
  sold bigint,
  abo bigint,
  reserved bigint,
  blocked bigint,
  free bigint,
  scanned bigint
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id_plan,
         count(*)                                              as seats,
         count(*) filter (where t.category = 'sold')            as sold,
         count(*) filter (where t.category = 'abo')             as abo,
         -- Zdrojová agregácia ráta len stav 11, nie 20 — držíme sa jej.
         count(*) filter (where t.id_seat_status = 11)          as reserved,
         count(*) filter (where t.category = 'blocked')         as blocked,
         count(*) filter (where t.category = 'free')            as free,
         count(*) filter (where t.scan > 0)                     as scanned
    from public.om_tickets t
   where t.id_plan = any (p_plany)
     and t.vanished_at is null
   group by t.id_plan;
$$;

revoke all on function public.om_pocty_podla_planu(bigint[]) from public, anon, authenticated;
grant execute on function public.om_pocty_podla_planu(bigint[]) to service_role;

-- --- Zjednotený pohľad ----------------------------------------------------
-- Dva systémy, jeden zoznam. Typy sa **nezlievajú**: OM identifikuje
-- predstavenie číslom (`id_plan`), my uuid (`event_id`), takže pohľad nesie
-- oboje a `source` hovorí, ktoré platí. Násilné zlúčenie do jedného stĺpca by
-- znamenalo mapovaciu tabuľku, ktorá zatiaľ neexistuje.
--
-- `state` je odvodený stav pre skener a prehľady:
--   cancelled  miesto sa vrátilo do predaja alebo plán zmizol
--   refunded   vrátené peniaze
--   scanned    posledná skenovacia udalosť je sken
--   valid      predaná vstupenka, zatiaľ neskontrolovaná
--   pending    rezervácia — ešte nie je predaj
--   blocked    blokované miesto
--
-- Poradie rozhodovania je zámerné: storno a refund prebíjajú sken. Vstupenka,
-- ktorá bola skontrolovaná a až potom refundovaná, nesmie vyzerať ako platná.

create or replace view public.tickets_unified
with (security_invoker = true) as
  -- Starý systém
  select
    'om'::text                                  as source,
    'om:' || t.id_seat                          as ticket_key,
    t.id_seat                                   as om_id_seat,
    null::uuid                                  as ticket_id,
    t.id_plan                                   as om_id_plan,
    null::uuid                                  as event_id,
    null::uuid                                  as event_date_id,
    e.drama_name                                as event_name,
    e.datum                                     as event_date,
    t.barcode::text                             as code,
    null::text                                  as seat_label,
    t.price,
    t.category::text                            as category,
    case
      when t.vanished_at is not null or e.cancelled_at is not null then 'cancelled'
      when t.category = 'free' then 'cancelled'
      when r.id_seat_note_refund is not null and r.date_refund is not null then 'refunded'
      when t.category = 'blocked' then 'blocked'
      when t.category = 'pending' then 'pending'
      when sk.scan_type = 0 then 'scanned'
      when t.category in ('sold', 'abo') then 'valid'
      else 'other'
    end                                         as state,
    case when sk.scan_type = 0 then sk.scan_time end as scanned_at,
    t.suspicious,
    coalesce(t.id_seat_note::text, t.synthetic_order_key) as order_key,
    case when t.id_seat_note is null then 'derived' else 'seat_note' end as order_source,
    t.modified_at                               as updated_at
  from public.om_tickets t
  left join public.om_events e on e.id_plan = t.id_plan
  left join public.om_posledny_sken sk
         on sk.id_plan = t.id_plan and sk.barcode = t.barcode
  left join public.om_refunds r
         on r.id_seat_note = t.id_seat_note and r.date_refund is not null

union all

  -- Náš systém
  select
    'eticketo'::text                            as source,
    'et:' || tk.id::text                        as ticket_key,
    null::bigint                                as om_id_seat,
    tk.id                                       as ticket_id,
    null::bigint                                as om_id_plan,
    tk.event_id,
    tk.event_date_id,
    ev.title                                    as event_name,
    ed.event_date                               as event_date,
    tk.qr_code                                  as code,
    tk.seat_label,
    null::numeric                               as price,
    'sold'::text                                as category,
    case
      when tk.refunded_at is not null then 'refunded'
      when tk.used_at is not null then 'scanned'
      else 'valid'
    end                                         as state,
    tk.used_at                                  as scanned_at,
    false                                       as suspicious,
    tk.order_id::text                           as order_key,
    'order'::text                               as order_source,
    tk.issued_at                                as updated_at
  from public.tickets tk
  left join public.events ev on ev.id = tk.event_id
  left join public.event_dates ed on ed.id = tk.event_date_id;

comment on view public.tickets_unified is
  'Vstupenky zo starého systému aj z nášho v jednom zozname. Stav OM vstupenky sa '
  'počíta z om_scans v poradí scan_time (nie podľa id) — pozri om_posledny_sken. '
  'Sú v ňom čiarové kódy, preto je prístupný len cez service_role.';

revoke all on public.om_posledny_sken from anon, authenticated;
revoke all on public.tickets_unified from anon, authenticated;
grant select on public.om_posledny_sken to service_role;
grant select on public.tickets_unified to service_role;
