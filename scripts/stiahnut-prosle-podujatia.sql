-- Stiahnutie prošlých a demo podujatí z verejného webu.
--
-- Z 130 publikovaných podujatí už 73 nemá budúci termín a ďalších 18 je demo
-- odpad z importu (`Y4Trade - …`). Všetky sú na verejnom webe aj v sitemape,
-- takže návštevník nájde v ponuke podujatia, ktoré sa dávno odohrali.
--
-- `listEvents` ani stránka `/events` podľa dátumu nefiltrujú, takže to nie je
-- vec jedného filtra — a pridať filter by skryl aj podujatia, ktoré organizátor
-- chce mať na webe ako referenciu. Preto sa to rieši stavom podujatia.
--
-- Prepnutie na `draft` NIE JE mazanie:
--   * vstupenky ostávajú vydané a v „Moje vstupenky" sa zobrazujú ďalej
--     (`getMyTickets` číta objednávky, nie katalóg),
--   * **naskenovať sa dajú aj tak** — `api/public/tickets/scan` odmieta len
--     podujatie v stave `cancelled`, nie `draft` (overené 8. 10. 2026),
--   * publikovať sa dá kedykoľvek späť jedným klikom v administrácii.
-- 13 z dotknutých podujatí má vydané vstupenky; práve preto `draft`, a nie
-- mazanie.
--
-- SPÚŠŤANIE: tento skript je NASUCHO — končí `rollback`, takže nič nezmení
-- a len vypíše, čo by sa stalo. Keď ti výpis sedí, zmeň poslednú riadku
-- `rollback` na `commit` a spusti znova:
--
--   /opt/maxiticket/restore/psql.sh -f scripts/stiahnut-prosle-podujatia.sql

begin;

create temporary table dotknute on commit drop as
select e.id,
       e.title,
       case when e.title ilike 'Y4Trade%' then 'demo z importu'
            else 'bez budúceho termínu' end as dovod,
       (select count(*) from public.tickets t where t.event_id = e.id) as vstupeniek
  from public.events e
 where e.status = 'published'
   and (
     e.title ilike 'Y4Trade%'
     or not exists (
       select 1 from public.event_dates d
        where d.event_id = e.id
          and d.event_date >= current_date
          and d.status <> 'cancelled'
     )
   );

\echo '--- PRED: čo sa dotkne ---'
select dovod, count(*) as podujatí, sum(vstupeniek) as vstupeniek
  from dotknute group by dovod order by dovod;

\echo '--- vzorka 15 názvov ---'
select title, dovod, vstupeniek from dotknute order by vstupeniek desc, title limit 15;

update public.events e
   set status = 'draft',
       updated_at = now()
 where e.id in (select id from dotknute);

\echo '--- PO: stav publikovaných podujatí ---'
select count(*) filter (where status = 'published') as publikovaných,
       count(*) filter (where status = 'draft') as konceptov,
       count(*) filter (where status = 'cancelled') as zrušených
  from public.events;

\echo '--- kontrola: ostali publikované len podujatia s budúcim termínom? ---'
select count(*) as publikovaných_bez_budúceho_termínu
  from public.events e
 where e.status = 'published'
   and not exists (
     select 1 from public.event_dates d
      where d.event_id = e.id
        and d.event_date >= current_date
        and d.status <> 'cancelled'
   );

-- Zmeň na `commit`, keď ti výpis sedí.
rollback;
