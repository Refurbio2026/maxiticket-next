-- Mapovanie starého systému na náš: ktorý OM plán je ktoré naše podujatie.
--
-- Bez tejto väzby sa nedá nič z toho, načo sa staré dáta ťahali: ukázať predaj
-- z oboch systémov v jednom zozname, načítať starú vstupenku našou čítačkou
-- ani spočítať tržbu podujatia. OM identifikuje predstavenie číslom (`id_plan`),
-- my dvojicou `events.id` + `event_dates.id` — spoločný kľúč neexistuje a
-- odvodiť sa dá len z názvu a dátumu.
--
-- **Mapuje sa na termín, nie na podujatie.** OM `plan` je jedno predstavenie
-- v jeden deň, čo u nás zodpovedá `event_dates`, nie `events`. Pri podujatí
-- s viacerými termínmi (dnes 15 zo 138) by väzba na `events` neurčila, o ktorý
-- deň ide, a predaj by sa zlial do nesprávneho termínu.

-- --- Podujatia -----------------------------------------------------------
-- `status` je jadro celej tabuľky. Automatické párovanie podľa názvu a dátumu
-- je **návrh**, nie pravda: názvy sa v oboch systémoch píšu ručne, dátum sa
-- môže prekladať a dve podujatia v ten istý deň s podobným názvom nie sú nič
-- výnimočné. Do peňazí ani do skenovania preto smie vstúpiť len väzba, ktorú
-- potvrdil človek.

create table if not exists public.om_event_map (
  id_plan bigint primary key,
  -- NULL je platný stav: plán, ktorý u nás náprotivok nemá (starý predaj
  -- organizátora, ktorý do eticketa neprešiel). Vtedy `status = 'rejected'`.
  event_id uuid references public.events (id) on delete cascade,
  event_date_id uuid references public.event_dates (id) on delete set null,
  status text not null default 'suggested'
    check (status in ('suggested', 'confirmed', 'rejected')),
  -- 0–1; pri ručnom priradení je to vždy 1.
  confidence numeric(3, 2) check (confidence >= 0 and confidence <= 1),
  matched_by text not null
    check (matched_by in ('auto_nazov_datum', 'auto_nazov', 'rucne')),
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- Potvrdená väzba musí vedieť, na čo ukazuje. Bez tejto podmienky by sa
  -- dalo potvrdiť prázdne mapovanie a ďalšie dotazy by ticho nevracali nič.
  constraint om_event_map_potvrdena_ma_ciel
    check (status <> 'confirmed' or (event_id is not null and event_date_id is not null))
);

comment on table public.om_event_map is
  'Väzba OM `plan` → náš `event_dates`. Počíta sa výhradne so `status = ''confirmed''`; '
  '`suggested` je návrh automatického párovania a čaká na človeka.';
comment on column public.om_event_map.event_id is
  'NULL znamená „plán u nás náprotivok nemá" — pri `status = ''rejected''` je to platný záver, nie chyba.';

-- Jeden náš termín smie mať najviac jeden potvrdený OM plán. Inak by sa do
-- termínu zliali dve rôzne predstavenia a tržba by sa zdvojila.
create unique index if not exists om_event_map_termin_unikat
  on public.om_event_map (event_date_id)
  where status = 'confirmed' and event_date_id is not null;

create index if not exists om_event_map_event_idx
  on public.om_event_map (event_id) where status = 'confirmed';
create index if not exists om_event_map_status_idx on public.om_event_map (status);

-- --- Organizátori ---------------------------------------------------------
-- OM má 72 promotérov, my 10 organizátorov — väčšina starého predaja patrí
-- niekomu, kto v eticketé účet nemá. Preto je aj tu `status`: nepotvrdený
-- promotér neznamená, že sa niekomu pripíše tržba.

create table if not exists public.om_promoter_map (
  id_promoter bigint primary key,
  organizer_id uuid references auth.users (id) on delete cascade,
  status text not null default 'suggested'
    check (status in ('suggested', 'confirmed', 'rejected')),
  matched_by text not null default 'rucne'
    check (matched_by in ('auto_nazov', 'rucne')),
  confirmed_by uuid references auth.users (id) on delete set null,
  confirmed_at timestamptz,
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint om_promoter_map_potvrdena_ma_ciel
    check (status <> 'confirmed' or organizer_id is not null)
);

create index if not exists om_promoter_map_organizer_idx
  on public.om_promoter_map (organizer_id) where status = 'confirmed';

-- --- Návrh mapovania ------------------------------------------------------
-- Párovanie je v databáze, nie vo workeri: je to jeden JOIN nad dátami, ktoré
-- sú obe v Postgrese, a ťahať ich kvôli tomu do JavaScriptu by nič nezlepšilo.
--
-- Párovanie má dve kolá a rozdiel medzi nimi je podstatný.
--
-- **Kolo 1: názov + dátum + čas.** Podujatie sa bežne hrá dvakrát za deň —
-- „Opice z našej police" o 10:00 a o 14:30 — a časy v oboch systémoch sedia na
-- minútu (aj tam, kde sú päť minút od seba, ako pri „P.S. LÉTO" 14:00 a 14:05).
-- Bez času by taká dvojica bola viacznačná a skončila by na ručnom posúdení
-- úplne zbytočne; s časom je jednoznačná.
--
-- **Kolo 2: názov + dátum** pre zvyšok, keď čas chýba alebo sa rozchádza.
-- Nižšia istota, lebo sa spolieha len na dva údaje.
--
-- V oboch kolách sa zapíše **iba jednoznačná zhoda**. Keď na plán sedí viac
-- našich termínov alebo je náš termín už niekomu navrhnutý, plán sa preskočí
-- a čaká na človeka. Hádať by tu znamenalo pripísať tržbu nesprávnemu
-- predstaveniu a nikto by si toho nevšimol.

create or replace function public.om_navrhni_mapovanie()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_kolo1 integer;
  v_kolo2 integer;
begin
  -- Kolo 1 — názov, dátum aj čas.
  with kandidati as (
    select o.id_plan, d.event_id, d.id as event_date_id,
           count(*) over (partition by o.id_plan) as zhod_na_plan,
           count(*) over (partition by d.id) as zhod_na_termin
      from public.om_events o
      join public.event_dates d
        on d.event_date = o.datum and d.event_time = o.start_time
      join public.events e
        on e.id = d.event_id and lower(btrim(e.title)) = lower(btrim(o.drama_name))
     where btrim(coalesce(o.drama_name, '')) <> ''
       and o.start_time is not null
       and d.event_time is not null
       and not exists (select 1 from public.om_event_map m where m.id_plan = o.id_plan)
  )
  insert into public.om_event_map
        (id_plan, event_id, event_date_id, status, confidence, matched_by)
  select id_plan, event_id, event_date_id, 'suggested', 0.95, 'auto_nazov_datum'
    from kandidati
   where zhod_na_plan = 1 and zhod_na_termin = 1;
  get diagnostics v_kolo1 = row_count;

  -- Kolo 2 — len názov a dátum, pre to, čo v kole 1 neprešlo.
  with kandidati as (
    select o.id_plan, d.event_id, d.id as event_date_id,
           count(*) over (partition by o.id_plan) as zhod_na_plan,
           count(*) over (partition by d.id) as zhod_na_termin
      from public.om_events o
      join public.event_dates d on d.event_date = o.datum
      join public.events e
        on e.id = d.event_id and lower(btrim(e.title)) = lower(btrim(o.drama_name))
     where btrim(coalesce(o.drama_name, '')) <> ''
       and not exists (select 1 from public.om_event_map m where m.id_plan = o.id_plan)
       -- Termín, ktorý už niekomu patrí, sa druhýkrát nenavrhne.
       and not exists (select 1 from public.om_event_map m2 where m2.event_date_id = d.id)
  )
  insert into public.om_event_map
        (id_plan, event_id, event_date_id, status, confidence, matched_by)
  select id_plan, event_id, event_date_id, 'suggested', 0.80, 'auto_nazov'
    from kandidati
   where zhod_na_plan = 1 and zhod_na_termin = 1;
  get diagnostics v_kolo2 = row_count;

  return v_kolo1 + v_kolo2;
end;
$$;

comment on function public.om_navrhni_mapovanie() is
  'Doplní návrhy väzieb pre plány, ktoré ešte nikto neposúdil. Viacznačnú zhodu '
  'preskočí — radšej nenamapované než nesprávne.';

-- --- Prehľad --------------------------------------------------------------
-- Čo ešte čaká na rozhodnutie a koľko predaja za tým visí. Bez tej sumy sa
-- nedá povedať, ktoré nepotvrdené väzby sú dôležité a ktoré sú okrajové.

create or replace view public.om_mapovanie_prehlad
with (security_invoker = true) as
select o.id_plan,
       o.drama_name,
       o.datum,
       o.hall_name,
       o.id_promoter,
       coalesce(m.status, 'unmapped') as status,
       m.confidence,
       m.event_id,
       m.event_date_id,
       e.title as nase_podujatie,
       count(t.id_seat) filter (where t.category = 'sold' and not t.suspicious) as predanych,
       coalesce(sum(t.price) filter (where t.category = 'sold' and not t.suspicious), 0) as trzba
  from public.om_events o
  left join public.om_event_map m on m.id_plan = o.id_plan
  left join public.events e on e.id = m.event_id
  left join public.om_tickets t on t.id_plan = o.id_plan and t.vanished_at is null
 group by o.id_plan, o.drama_name, o.datum, o.hall_name, o.id_promoter,
          m.status, m.confidence, m.event_id, m.event_date_id, e.title;

comment on view public.om_mapovanie_prehlad is
  'Stav mapovania po plánoch aj s tým, koľko predaja za každým visí. '
  'Tržba je v cenách starého systému — tie sú vrátane DPH.';

-- --- Prístup --------------------------------------------------------------
-- Rovnako ako zvyšok `om_*`: iba service_role, RLS zapnutá bez politík.
-- Admin sa k tomu dostane cez serverové funkcie, nie priamo cez API.

alter table public.om_event_map enable row level security;
alter table public.om_promoter_map enable row level security;

revoke all on table public.om_event_map from anon, authenticated;
revoke all on table public.om_promoter_map from anon, authenticated;
revoke all on public.om_mapovanie_prehlad from anon, authenticated;

grant all on table public.om_event_map to service_role;
grant all on table public.om_promoter_map to service_role;
grant select on public.om_mapovanie_prehlad to service_role;

revoke all on function public.om_navrhni_mapovanie() from public, anon, authenticated;
grant execute on function public.om_navrhni_mapovanie() to service_role;

-- Prvé naplnenie návrhov. Funkcia je idempotentná — posúdené plány preskočí.
select public.om_navrhni_mapovanie();
