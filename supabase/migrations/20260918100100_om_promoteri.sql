-- Organizátori starého systému.
--
-- V OM organizátor nemal účet — bol to len záznam v `promoter`. Účty sú vec
-- eticketa, takže väčšina starého predaja patrí niekomu, kto tu používateľa
-- nemá a mať nebude. Pre prevádzkový prehľad to ale nevadí: podstatné je
-- vedieť, **čie** to podujatie bolo, nie či sa vie prihlásiť.
--
-- Bez tejto tabuľky by prehľad starého predaja ukazoval „organizátor 923".
--
-- `om_promoter_map` (predchádzajúca migrácia) ostáva na niečo iné: spojiť
-- starého promotéra s naším organizátorom tam, kde obaja existujú. Nie je to
-- podmienka viditeľnosti, iba väzba pre spoločné čísla.

create table if not exists public.om_promoters (
  id_promoter bigint primary key,
  -- `name` je krátky názov, `event_promoter` je to, čo sa tlačí na vstupenku.
  name text,
  event_promoter text,
  ico text,
  dic text,
  ic_dph text,
  contact_name text,
  email text,
  tel text,
  city text,
  country_code text,
  -- Sadzba DPH organizátora. Ceny v OM sú **vrátane DPH**, takže bez nej sa
  -- zo starej tržby základ dane nedopočíta.
  vat_rate numeric(5, 2),
  hold_percentage numeric(5, 2),
  active boolean,
  visible boolean,
  -- `promoter` má v OM `modified`, na rozdiel od `drama` či `hall_desc`.
  -- Dnes ho neberieme ako kurzor — 437 riadkov sa obnoví celých pri dennom
  -- refreshi — ale keby raz bolo treba jemnejšie, je z čoho.
  modified_at timestamptz,
  raw jsonb,
  synced_at timestamptz not null default now()
);

comment on table public.om_promoters is
  'Organizátori zo starého systému. IBAN a SWIFT sa zámerne neprenášajú — '
  'na prehľad nie sú potrebné a je to najlacnejší spôsob, ako ich tu nemať.';

create index if not exists om_promoters_name_idx on public.om_promoters (lower(name));
create index if not exists om_promoters_aktivni_idx on public.om_promoters (id_promoter)
  where active;

alter table public.om_promoters enable row level security;
revoke all on table public.om_promoters from anon, authenticated;
grant all on table public.om_promoters to service_role;

-- --- Prehľad starého predaja ---------------------------------------------
-- Celý starý systém tak, ako bol: každý plán aj s organizátorom, počtom
-- vstupeniek a tržbou. **Nefiltruje sa podľa toho, či má podujatie náprotivok
-- v eticketé** — 87 % starého predaja ho nemá a do prevádzkového prehľadu
-- patrí rovnako ako zvyšok.
--
-- Tržba je v cenách starého systému, teda **vrátane DPH**.

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
       coalesce(sum(t.price) filter (where t.category = 'sold' and not t.suspicious), 0) as trzba_s_dph
  from public.om_events o
  left join public.om_promoters p on p.id_promoter = o.id_promoter
  left join public.om_event_map m on m.id_plan = o.id_plan
  left join public.om_tickets t on t.id_plan = o.id_plan and t.vanished_at is null
 group by o.id_plan, o.drama_name, o.datum, o.start_time, o.hall_name, o.id_promoter,
          p.event_promoter, p.name, p.ico, p.vat_rate, m.status, m.event_id, m.event_date_id;

comment on view public.om_predaj_prehlad is
  'Predaj starého systému po predstaveniach, aj s organizátorom. Zahŕňa aj plány '
  'bez náprotivku v eticketé — tie tvoria väčšinu. `trzba_s_dph` je vrátane DPH.';

revoke all on public.om_predaj_prehlad from anon, authenticated;
grant select on public.om_predaj_prehlad to service_role;
