-- Kategórie podujatí ako číselník.
--
-- Doteraz existovali na troch miestach naraz a ani jedno nesedelo s druhým:
-- admin stránka `/admin/data/categories` ich držala v localStorage prehliadača,
-- formulár podujatia mal vlastný natvrdo zapísaný zoznam v komponente a samotné
-- podujatie ukladá kategóriu ako voľný text. Premenovanie kategórie v admine sa
-- teda nikde neprejavilo a nová kategória sa do formulára nikdy nedostala.
--
-- `events.category` ostáva textom — číta ho verejný katalóg aj filtre a
-- podujatie musí prežiť zmazanie kategórie. Číselník je zdroj pravdy pre
-- ponuku vo formulári; premenovanie sa do podujatí prepíše v `upsertEventCategory`.

create table if not exists public.event_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  description text,
  -- Poradie v ponuke; rovnaké čísla sa zoradia podľa názvu.
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists event_categories_slug_key on public.event_categories (slug);
create unique index if not exists event_categories_name_key
  on public.event_categories (lower(name));

drop trigger if exists trg_event_categories_updated_at on public.event_categories;
create trigger trg_event_categories_updated_at
  before update on public.event_categories
  for each row execute function public.update_updated_at_column();

-- Naplnenie: najprv predvolené názvy, potom čokoľvek, čo už podujatia reálne
-- používajú — inak by kategória existujúceho podujatia zmizla z ponuky.
insert into public.event_categories (name, slug, sort_order)
values
  ('Koncert', 'koncert', 10),
  ('Festival', 'festival', 20),
  ('Divadlo', 'divadlo', 30),
  ('Šport', 'sport', 40),
  ('Stand-up', 'stand-up', 50),
  ('Konferencia', 'konferencia', 60),
  ('Kultúra', 'kultura', 70)
on conflict do nothing;

insert into public.event_categories (name, slug, sort_order)
select distinct
  e.category,
  lower(regexp_replace(translate(e.category, 'áäčďéíĺľňóôŕšťúýžÁÄČĎÉÍĹĽŇÓÔŔŠŤÚÝŽ', 'aacdeillnoorstuyzAACDEILLNOORSTUYZ'), '[^a-zA-Z0-9]+', '-', 'g')),
  100
from public.events e
where e.category is not null
  and btrim(e.category) <> ''
  and not exists (
    select 1 from public.event_categories c where lower(c.name) = lower(e.category)
  )
on conflict do nothing;

-- Kategórie sú verejná informácia — filtruje podľa nich katalóg.
alter table public.event_categories enable row level security;

drop policy if exists event_categories_public_select on public.event_categories;
create policy event_categories_public_select on public.event_categories
  for select to anon, authenticated
  using (true);

drop policy if exists event_categories_admin_write on public.event_categories;
create policy event_categories_admin_write on public.event_categories
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

grant select on public.event_categories to anon, authenticated;
grant insert, update, delete on public.event_categories to authenticated;
