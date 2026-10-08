-- Dočasné stiahnutie podujatí, ktoré sa predávajú aj v starom systéme.
--
-- PROBLÉM: pri podujatí, ktoré je spárované so starým systémom (OM), vie OM
-- predať sedadlo, o ktorom náš plán sály nevie — `seat_inventory` plníme len
-- my. Kupujúci si teda u nás vyberie miesto, ktoré je už obsadené, zaplatí ho
-- a pri dverách sa to zistí. K 8. 10. 2026 je takto ohrozených **2 114 miest
-- na 29 podujatiach** a najbližšie z nich je o deň.
--
-- Prečo nie prenos obsadených miest do plánu sály: na úrovni sedadla sa to
-- dnes nedá. `om_tickets` nesie `id_theater_seat`, ale katalóg sedadiel
-- starého systému sa nikdy nesynchronizoval, a naše `seat_id` sú vnútorné
-- identifikátory z editora sál (`s37`, `s7x`), nie rad a číslo. Mapovanie by
-- znamenalo doniesť `hall_desc` a overiť 20 sál — a chybné mapovanie zablokuje
-- nesprávne sedadlo, čo je horšie než žiadne.
--
-- ČO TENTO SKRIPT ROBÍ: prepne na `draft` tie publikované budúce podujatia,
-- ktoré sú spárované s OM **a OM na nich už niečo predal**. Podujatia, ktoré
-- sú v OM vypísané ale bez predaja, nechá publikované a len ich vypíše — tam
-- kolízia dnes nehrozí, hoci môže vzniknúť.
--
-- Prepnutie na `draft` NIE JE mazanie: vstupenky ostávajú vydané, v „Moje
-- vstupenky" sa zobrazujú ďalej, **naskenovať sa dajú aj tak** (sken odmieta
-- len `cancelled`, nie `draft`, overené 8. 10. 2026) a publikovať sa dá
-- kedykoľvek späť jedným klikom v administrácii.
--
-- SPÚŠŤANIE: skript je NASUCHO — končí `rollback`, takže nič nezmení a len
-- vypíše, čo by sa stalo. Keď ti výpis sedí, zmeň poslednú riadku `rollback`
-- na `commit` a spusti znova:
--
--   /opt/maxiticket/restore/psql.sh -f scripts/stiahnut-kolizne-podujatia.sql

begin;

create temporary table om_prehlad on commit drop as
select e.id,
       e.title,
       e.event_date,
       e.sale_type::text as typ_predaja,
       e.venue,
       count(t.id_seat) as predanych_v_om
  from public.om_event_map m
  join public.events e on e.id = m.event_id
  left join public.om_tickets t
         on t.id_plan = m.id_plan
        and t.category = 'sold'
        and t.vanished_at is null
 where e.status = 'published'
   and e.event_date >= current_date
   -- Darčekové poukazy sú vedené ako podujatie (kategória `divadlo`, sála
   -- bábkového divadla, 330 „miest", cena = hodnota poukazu), takže do výberu
   -- padnú tiež. Pri poukaze ale nejde o konkrétne sedadlo — nikto si naň
   -- nesadne — a pri 330 miestach a 108 predaných v OM nehrozí ani vyčerpanie
   -- kapacity. Stiahnutím by sa teda len zastavil predaj poukazov, bez toho,
   -- aby sa čomukoľvek zabránilo.
   --
   -- Zhoda na texte je krehká, ale iná sa nedá: poukazy nemajú žiadny znak,
   -- ktorý by ich odlíšil od skutočných predstavení. Keby raz pribudli poukazy
   -- s iným názvom, treba to tu doplniť.
   and e.title not ilike '%darčekový poukaz%'
 group by e.id, e.title, e.event_date, e.sale_type, e.venue;

\echo ''
\echo '=== 1/4  Ohrozené podujatia (OM už predal) — TIETO sa stiahnu ==='
select title,
       to_char(event_date, 'DD.MM.YYYY') as datum,
       typ_predaja,
       predanych_v_om
  from om_prehlad
 where predanych_v_om > 0
 order by event_date, predanych_v_om desc;

\echo ''
\echo '=== 2/4  Súhrn toho, čo sa stiahne ==='
select typ_predaja,
       count(*) as podujatí,
       sum(predanych_v_om) as ohrozených_miest,
       min(event_date) as najbližšie
  from om_prehlad
 where predanych_v_om > 0
 group by typ_predaja
 order by 3 desc;

\echo ''
\echo '=== 3/4  Spárované s OM, ale bez predaja — ZOSTÁVAJÚ publikované ==='
\echo '      (kolízia dnes nehrozí; keby sa v OM predaj spustil, treba ich stiahnuť tiež)'
select count(*) as podujatí_ponechaných_v_predaji from om_prehlad where predanych_v_om = 0;

update public.events e
   set status = 'draft',
       updated_at = now()
 where e.id in (select id from om_prehlad where predanych_v_om > 0);

-- Záznam, čo sa stiahlo a prečo. Bez neho si o mesiac nikto nespomenie, ktoré
-- podujatia boli koncepty kvôli starému systému a ktoré z iného dôvodu —
-- a `scripts/vratit-kolizne-podujatia.sql` ich vracia práve podľa tohto.
insert into public.audit_log (entity, entity_id, action, before, after, reason)
select 'event',
       -- `audit_log.entity_id` je `text`, `events.id` je `uuid` — bez
       -- pretypovania Postgres vkladanie odmietne.
       p.id::text,
       'stiahnute_kvoli_om',
       jsonb_build_object('status', 'published'),
       jsonb_build_object('status', 'draft', 'predanych_v_om', p.predanych_v_om),
       'Predáva sa aj v starom systéme a plán sály o tých miestach nevie'
  from om_prehlad p
 where p.predanych_v_om > 0;

\echo ''
\echo '=== 4/4  Stav po zmene ==='
select count(*) filter (where status = 'published') as publikovaných,
       count(*) filter (where status = 'draft') as konceptov,
       count(*) filter (where status = 'cancelled') as zrušených
  from public.events;

\echo ''
\echo '--- kontrola: ostalo v predaji predstavenie, na ktorom OM už predal? (má byť 0) ---'
\echo '    Darčekové poukazy sa nepočítajú — tie zostávajú v predaji zámerne.'
select count(*) as ohrozených_stále_v_predaji
  from public.om_event_map m
  join public.events e on e.id = m.event_id
 where e.status = 'published'
   and e.event_date >= current_date
   and e.title not ilike '%darčekový poukaz%'
   and exists (
     select 1 from public.om_tickets t
      where t.id_plan = m.id_plan
        and t.category = 'sold'
        and t.vanished_at is null
   );

-- Zmeň na `commit`, keď ti výpis sedí.
rollback;
