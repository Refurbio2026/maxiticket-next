-- Vrátenie podujatí, ktoré `stiahnut-kolizne-podujatia.sql` prepol na koncept.
--
-- Spusti, keď dôvod zmizol — teda keď sa v starom systéme zavrel predaj na
-- tých podujatiach, alebo keď už plán sály o obsadených miestach vie.
--
-- Vracia **len** tie, ktoré stiahol ten skript (podľa záznamu v `audit_log`,
-- akcia `stiahnute_kvoli_om`), a **len tie, ktoré sú dnes koncepty** — keby si
-- niektoré medzitým publikoval ručne alebo zrušil, nesiaha na ne.
--
-- Zrušené podujatia nechá zrušené: `cancelled` je rozhodnutie, nie dôsledok
-- tohto opatrenia.
--
-- SPÚŠŤANIE: nasucho (končí `rollback`). Keď výpis sedí, zmeň `rollback`
-- na `commit`:
--
--   /opt/maxiticket/restore/psql.sh -f scripts/vratit-kolizne-podujatia.sql

begin;

create temporary table na_vratenie on commit drop as
select distinct e.id, e.title, e.event_date
  from public.audit_log a
  -- `audit_log.entity_id` je `text`, `events.id` je `uuid`.
  join public.events e on e.id::text = a.entity_id
 where a.entity = 'event'
   and a.action = 'stiahnute_kvoli_om'
   and e.status = 'draft';

\echo ''
\echo '=== Čo sa vráti do predaja ==='
select title, to_char(event_date, 'DD.MM.YYYY') as datum from na_vratenie order by event_date;

\echo ''
\echo '--- koľko ich je ---'
select count(*) as vrátených from na_vratenie;

\echo ''
\echo '--- POZOR: koľko z nich má v OM stále predané miesta? ---'
\echo '    Ak to nie je 0, dôvod stiahnutia ešte trvá a vracať ich je skoro.'
select count(distinct v.id) as stále_kolízne
  from na_vratenie v
  join public.om_event_map m on m.event_id = v.id
 where exists (
   select 1 from public.om_tickets t
    where t.id_plan = m.id_plan
      and t.category = 'sold'
      and t.vanished_at is null
 );

update public.events e
   set status = 'published',
       updated_at = now()
 where e.id in (select id from na_vratenie);

insert into public.audit_log (entity, entity_id, action, before, after, reason)
select 'event',
       v.id::text,
       'vratene_po_om',
       jsonb_build_object('status', 'draft'),
       jsonb_build_object('status', 'published'),
       'Dôvod stiahnutia kvôli starému systému zanikol'
  from na_vratenie v;

\echo ''
\echo '=== Stav po zmene ==='
select count(*) filter (where status = 'published') as publikovaných,
       count(*) filter (where status = 'draft') as konceptov
  from public.events;

-- Zmeň na `commit`, keď ti výpis sedí.
rollback;
