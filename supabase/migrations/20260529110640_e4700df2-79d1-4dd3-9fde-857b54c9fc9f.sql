
-- ROLES
create type public.app_role as enum ('user', 'organizer', 'admin');

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update on public.profiles to authenticated;
grant all on public.profiles to service_role;
alter table public.profiles enable row level security;
create policy "profiles_self_select" on public.profiles for select to authenticated using (auth.uid() = id);
create policy "profiles_self_update" on public.profiles for update to authenticated using (auth.uid() = id);
create policy "profiles_self_insert" on public.profiles for insert to authenticated with check (auth.uid() = id);

create table public.user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  role app_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);
grant select on public.user_roles to authenticated;
grant all on public.user_roles to service_role;
alter table public.user_roles enable row level security;

create or replace function public.has_role(_user_id uuid, _role app_role)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.user_roles where user_id = _user_id and role = _role)
$$;

create policy "user_roles_self_select" on public.user_roles for select to authenticated using (user_id = auth.uid());
create policy "user_roles_admin_all" on public.user_roles for all to authenticated using (public.has_role(auth.uid(), 'admin')) with check (public.has_role(auth.uid(), 'admin'));

-- Auto-create profile + default 'user' role on signup
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.profiles (id, full_name)
  values (new.id, coalesce(new.raw_user_meta_data ->> 'full_name', new.email));
  insert into public.user_roles (user_id, role) values (new.id, 'user');
  return new;
end;
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_user();

-- EVENTS
create type public.event_status as enum ('draft', 'published');

create table public.events (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references auth.users(id) on delete cascade,
  title text not null,
  category text not null,
  event_date date not null,
  event_time time not null,
  venue text not null,
  city text not null,
  description text,
  image_url text,
  status event_status not null default 'draft',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
grant select, insert, update, delete on public.events to authenticated;
grant select on public.events to anon;
grant all on public.events to service_role;
alter table public.events enable row level security;

create policy "events_public_published_select" on public.events for select to anon, authenticated using (status = 'published' or organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "events_organizer_insert" on public.events for insert to authenticated with check (organizer_id = auth.uid() and (public.has_role(auth.uid(), 'organizer') or public.has_role(auth.uid(), 'admin')));
create policy "events_owner_update" on public.events for update to authenticated using (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'));
create policy "events_owner_delete" on public.events for delete to authenticated using (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

-- TICKET TYPES
create table public.ticket_types (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  name text not null,
  price numeric(10,2) not null default 0,
  quantity integer not null default 0,
  created_at timestamptz not null default now()
);
grant select, insert, update, delete on public.ticket_types to authenticated;
grant select on public.ticket_types to anon;
grant all on public.ticket_types to service_role;
alter table public.ticket_types enable row level security;

create policy "ticket_types_public_select" on public.ticket_types for select to anon, authenticated using (
  exists (select 1 from public.events e where e.id = event_id and (e.status = 'published' or e.organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin')))
);
create policy "ticket_types_owner_modify" on public.ticket_types for all to authenticated using (
  exists (select 1 from public.events e where e.id = event_id and (e.organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin')))
) with check (
  exists (select 1 from public.events e where e.id = event_id and (e.organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin')))
);

create index events_status_date_idx on public.events (status, event_date);
create index events_organizer_idx on public.events (organizer_id);
create index ticket_types_event_idx on public.ticket_types (event_id);
