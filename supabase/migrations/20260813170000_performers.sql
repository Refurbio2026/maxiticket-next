-- Účinkujúci (umelci, kapely, hostia, súbory) a ich väzba na podujatia.
--
-- Doteraz nebolo kde ich viesť: admin stránka `/admin/data/performers` ukazovala
-- generované demo riadky a verejná `/artists` vypisovala osem natvrdo zapísaných
-- mien priamo v komponente. Návštevník teda na verejnom webe videl vymyslených
-- interpretov, ktorí nikde nevystupovali.
--
-- Väzba je M:N — na festivale hrá viac umelcov a jeden umelec vystupuje na
-- viacerých podujatiach. Žáner je voľný text, nie ďalší číselník: filtre na
-- verejnej stránke sa skladajú z toho, čo je reálne vyplnené.

create table if not exists public.performers (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  -- Rock, Rap, Elektronika, Divadlo… len na zoskupenie vo výpise.
  genre text,
  city text,
  bio text,
  image_url text,
  website text,
  -- Skrytý účinkujúci zostáva pri podujatiach, len sa neponúka a nevypisuje.
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists performers_slug_key on public.performers (slug);
create unique index if not exists performers_name_key on public.performers (lower(name));
create index if not exists performers_genre_idx on public.performers (genre);

drop trigger if exists trg_performers_updated_at on public.performers;
create trigger trg_performers_updated_at
  before update on public.performers
  for each row execute function public.update_updated_at_column();

-- Zostava podujatia. `sort_order` drží poradie na plagáte (headliner prvý).
create table if not exists public.event_performers (
  event_id uuid not null references public.events(id) on delete cascade,
  performer_id uuid not null references public.performers(id) on delete cascade,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  primary key (event_id, performer_id)
);

create index if not exists event_performers_performer_idx
  on public.event_performers (performer_id);

alter table public.performers enable row level security;
alter table public.event_performers enable row level security;

-- Zostava je súčasť ponuky — číta ju verejný katalóg aj neprihlásený návštevník.
drop policy if exists performers_public_select on public.performers;
create policy performers_public_select on public.performers
  for select to anon, authenticated
  using (true);

drop policy if exists performers_admin_write on public.performers;
create policy performers_admin_write on public.performers
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists event_performers_public_select on public.event_performers;
create policy event_performers_public_select on public.event_performers
  for select to anon, authenticated
  using (true);

-- Zostavu podujatia smie meniť admin aj organizátor daného podujatia.
drop policy if exists event_performers_write on public.event_performers;
create policy event_performers_write on public.event_performers
  for all to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::app_role)
    or exists (
      select 1 from public.events e
      where e.id = event_performers.event_id and e.organizer_id = auth.uid()
    )
  )
  with check (
    public.has_role(auth.uid(), 'admin'::app_role)
    or exists (
      select 1 from public.events e
      where e.id = event_performers.event_id and e.organizer_id = auth.uid()
    )
  );

grant select on public.performers to anon, authenticated;
grant select on public.event_performers to anon, authenticated;
grant insert, update, delete on public.performers to authenticated;
grant insert, update, delete on public.event_performers to authenticated;
grant all on public.performers to service_role;
grant all on public.event_performers to service_role;
