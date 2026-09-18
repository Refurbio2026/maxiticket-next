-- Do prehľadu starého predaja pribúda názov nášho podujatia a termín.
--
-- Bez nich sa väzba nedá potvrdiť so zdravým rozumom: obsluha vidí, že plán
-- 23763 má navrhnuté spárovanie, ale nie, s čím. Potvrdzovať väzbu, ktorá
-- otvára dvere skeneru, naslepo nemá zmysel.
--
-- `create or replace view` dovoľuje pridať stĺpce len na koniec, preto sú tam.

create or replace view public.om_predaj_prehlad
with (security_invoker = true) as
select o.id_plan,
       o.drama_name,
       o.datum,
       o.start_time,
       o.hall_name,
       o.id_promoter,
       coalesce(nullif(btrim(p.event_promoter), ''), p.name) as promoter,
       p.ico,
       p.vat_rate,
       coalesce(m.status, 'unmapped') as mapovanie,
       m.event_id,
       m.event_date_id,
       count(t.id_seat) filter (where t.category = 'sold' and not t.suspicious) as predanych,
       count(t.id_seat) filter (where t.category = 'abo') as permanentiek,
       count(t.id_seat) filter (where t.category = 'pending') as rezervovanych,
       count(t.id_seat) filter (where t.scan > 0) as naskenovanych,
       count(t.id_seat) filter (where t.suspicious) as podozrivych,
       coalesce(sum(t.price) filter (where t.category = 'sold' and not t.suspicious), 0) as trzba_s_dph,
       e.title as nase_podujatie,
       d.event_date as nas_datum,
       d.event_time as nas_cas,
       m.confidence
  from public.om_events o
  left join public.om_promoters p on p.id_promoter = o.id_promoter
  left join public.om_event_map m on m.id_plan = o.id_plan
  left join public.events e on e.id = m.event_id
  left join public.event_dates d on d.id = m.event_date_id
  left join public.om_tickets t on t.id_plan = o.id_plan and t.vanished_at is null
 group by o.id_plan, o.drama_name, o.datum, o.start_time, o.hall_name, o.id_promoter,
          p.event_promoter, p.name, p.ico, p.vat_rate, m.status, m.event_id, m.event_date_id,
          e.title, d.event_date, d.event_time, m.confidence;
