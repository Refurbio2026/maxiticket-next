-- Miesta konania ako číselník.
--
-- Doteraz sa hala písala ku každému podujatiu ako voľný text (`events.venue`,
-- `city`, `address`), takže „Slovenská filharmónia" a „Slovenska filharmonia"
-- boli dve rôzne miesta a rozloženie sály sa priraďovalo zvlášť pri každom
-- podujatí. Teraz je to väzba na záznam, ktorý si nesie aj predvolenú sálu.
--
-- Textové stĺpce v `events` zámerne ZOSTÁVAJÚ vyplnené — číta ich verejný
-- katalóg, PDF vstupenky aj e-maily, a pri zmazanom mieste musí podujatie
-- naďalej vedieť, kde sa konalo. Server ich pri uložení kopíruje z miesta.

create table if not exists public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  city text not null,
  address text,
  note text,
  -- Predvolené rozloženie sály. Podujatie si ho môže prepísať vlastným.
  default_layout_id uuid references public.venue_layouts(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists venues_name_city_uniq
  on public.venues (lower(name), lower(city));

alter table public.venues enable row level security;

-- Zoznam miest je súčasť ponuky (adresa podujatia), takže ho smie čítať aj
-- neprihlásený návštevník. Zapisuje admin.
create policy venues_public_select on public.venues
  for select to anon, authenticated using (true);

create policy venues_admin_write on public.venues
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'))
  with check (public.has_role(auth.uid(), 'admin'));

grant select on public.venues to anon, authenticated;
grant all on public.venues to service_role;

create trigger trg_venues_updated_at
  before update on public.venues
  for each row execute function public.update_updated_at_column();

alter table public.events
  add column if not exists venue_id uuid references public.venues(id) on delete set null;

create index if not exists events_venue_id_idx on public.events (venue_id);

-- Nový stĺpec musí vidieť aj anonymný katalóg (stĺpcový grant z 20260727120000).
grant select (venue_id) on public.events to anon;

-- Z existujúcich podujatí spravíme prvé miesta, nech sa nezačína na zelenej lúke.
insert into public.venues (name, city, address)
select distinct on (lower(e.venue), lower(e.city))
       e.venue, e.city, nullif(e.address, '')
from public.events e
where coalesce(e.venue, '') <> '' and coalesce(e.city, '') <> ''
on conflict do nothing;

update public.events e
set venue_id = v.id
from public.venues v
where lower(v.name) = lower(e.venue)
  and lower(v.city) = lower(e.city)
  and e.venue_id is null;

-- Kde už podujatie malo priradenú sálu, nech ju miesto zdedí ako predvolenú.
update public.venues v
set default_layout_id = e.venue_layout_id
from public.events e
where e.venue_id = v.id
  and e.venue_layout_id is not null
  and v.default_layout_id is null;
