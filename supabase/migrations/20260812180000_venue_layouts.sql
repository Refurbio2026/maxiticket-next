-- Rozloženia sál do databázy.
--
-- Doteraz žili v localStorage (`layouts-db.ts`), takže sála vytvorená na jednom
-- počítači neexistovala nikde inde — a hlavne o nej nevedel server. Preto musel
-- pri objednávke veriť klientovi, že sedadlo je VIP, a podľa toho vyberať medzi
-- `vip_price` a `base_price`. So schémou v databáze si to server overí sám.
--
-- Tvary aj oblúkové skupiny sú JSONB: sú to voľné štruktúry editora, ktoré sa
-- menia s ním, a relačný rozpad by neprinášal nič — nedotazujeme sa do nich.

create table if not exists public.venue_layouts (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid references auth.users(id) on delete set null,
  name text not null,
  type text not null default 'koncertna-hala',
  city text,
  address text,
  note text,
  capacity integer,
  shapes jsonb not null default '[]'::jsonb,
  curve_groups jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists venue_layouts_owner_idx on public.venue_layouts (owner_id);

create trigger trg_venue_layouts_updated_at
  before update on public.venue_layouts
  for each row execute function public.update_updated_at_column();

alter table public.venue_layouts enable row level security;

-- Plán sály je súčasť ponuky — kupujúci ho musí vidieť aj bez prihlásenia,
-- inak by sa nedalo vybrať sedadlo.
create policy venue_layouts_public_select on public.venue_layouts
  for select to anon, authenticated using (true);

-- Zakladať a upravovať smie organizátor (svoje) a admin (všetky).
create policy venue_layouts_owner_insert on public.venue_layouts
  for insert to authenticated
  with check (
    owner_id = auth.uid()
    and (public.has_role(auth.uid(), 'organizer') or public.has_role(auth.uid(), 'admin'))
  );

create policy venue_layouts_owner_update on public.venue_layouts
  for update to authenticated
  using (owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

create policy venue_layouts_owner_delete on public.venue_layouts
  for delete to authenticated
  using (owner_id = auth.uid() or public.has_role(auth.uid(), 'admin'));

grant select on public.venue_layouts to anon, authenticated;
grant insert, update, delete on public.venue_layouts to authenticated;
grant all on public.venue_layouts to service_role;

-- `events.venue_layout_id` bol voľný text z localStorage. Teraz je to skutočná
-- väzba. Stĺpec je zatiaľ všade NULL, takže prevod je bezpečný.
alter table public.events
  alter column venue_layout_id type uuid using nullif(venue_layout_id, '')::uuid;

alter table public.events
  add constraint events_venue_layout_id_fkey
  foreign key (venue_layout_id) references public.venue_layouts(id) on delete set null;

-- Nové stĺpce musí vidieť aj anonymný katalóg (stĺpcový grant z 20260727120000).
grant select (venue_layout_id) on public.events to anon;
