-- Skupiny podujatí (série, festivalové ročníky, predplatné cykly).
--
-- Podujatia, ktoré patria k sebe, sa doteraz nedali nijako spojiť — v katalógu
-- aj v admine stáli vedľa seba ako nesúvisiace položky. Stránka
-- `/admin/data/groups` taký zoznam predstierala nad generovanými dátami.
--
-- Väzba je 1:N — jedno podujatie patrí najviac do jednej skupiny. Na rozdiel od
-- kategórie tu nedrží podujatie žiadny text: skupina je voliteľná a keď zanikne,
-- podujatie ostáva bez nej (`on delete set null`).

create table if not exists public.event_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  description text,
  image_url text,
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists event_groups_slug_key on public.event_groups (slug);
create unique index if not exists event_groups_name_key on public.event_groups (lower(name));

drop trigger if exists trg_event_groups_updated_at on public.event_groups;
create trigger trg_event_groups_updated_at
  before update on public.event_groups
  for each row execute function public.update_updated_at_column();

alter table public.events
  add column if not exists group_id uuid references public.event_groups(id) on delete set null;

create index if not exists events_group_id_idx on public.events (group_id);

-- Nový stĺpec musí vidieť aj anonymný katalóg (stĺpcový grant z 20260727120000).
grant select (group_id) on public.events to anon;

alter table public.event_groups enable row level security;

-- Skupina je súčasť ponuky — filtruje sa podľa nej katalóg.
drop policy if exists event_groups_public_select on public.event_groups;
create policy event_groups_public_select on public.event_groups
  for select to anon, authenticated
  using (true);

drop policy if exists event_groups_admin_write on public.event_groups;
create policy event_groups_admin_write on public.event_groups
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

grant select on public.event_groups to anon, authenticated;
grant insert, update, delete on public.event_groups to authenticated;
grant all on public.event_groups to service_role;
