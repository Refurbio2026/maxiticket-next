-- Cenové kategórie (zóny) sály a ich ceny na podujatie.
--
-- Editor hál ponúkal päť kategórií (Regular, VIP, Premium, Early Bird, ZŤP)
-- natvrdo zapísaných v komponente, ale ocenenie na serveri poznalo len dve
-- ceny: `events.vip_price` pre VIP a `events.base_price` pre všetko ostatné.
-- Sedadlo označené ako Premium sa teda predalo za základnú cenu — a zákaznícka
-- mapa mu tú istú cenu aj ukázala, takže si toho nikto nevšimol.
--
-- `price_categories` je číselník zón (spoločný pre celú platformu),
-- `event_price_categories` je cena zóny pre konkrétne podujatie.
--
-- ROZŠÍRENIE, NIE NÁHRADA: `base_price` a `vip_price` ostávajú a platia, kým
-- podujatiu nikto cenu zóny nenastaví. Existujúce podujatia sa preto správajú
-- presne ako doteraz.

create table if not exists public.price_categories (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null,
  -- Farba sedadiel v mape; NULL = mapa použije svoju predvolenú.
  color text,
  description text,
  sort_order integer not null default 100,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists price_categories_slug_key on public.price_categories (slug);
create unique index if not exists price_categories_name_key
  on public.price_categories (lower(name));

drop trigger if exists trg_price_categories_updated_at on public.price_categories;
create trigger trg_price_categories_updated_at
  before update on public.price_categories
  for each row execute function public.update_updated_at_column();

-- Presne tie kategórie, ktoré doteraz ponúkal editor — aby sa existujúce
-- rozloženia sál mali na čo naviazať.
insert into public.price_categories (name, slug, color, sort_order, description)
values
  ('Regular', 'regular', '#22c55e', 10, 'Základná cena podujatia.'),
  ('VIP', 'vip', '#eab308', 20, 'Prémiová zóna; bez vlastnej ceny sa použije VIP cena podujatia.'),
  ('Premium', 'premium', '#a855f7', 30, 'Lepšie miesta za príplatok.'),
  ('Early Bird', 'early-bird', '#38bdf8', 40, 'Zvýhodnená cena pre skorý nákup.'),
  ('ZŤP', 'ztp', '#f97316', 50, 'Miesta pre návštevníkov so zdravotným postihnutím.')
on conflict do nothing;

-- --- Cena zóny na podujatie ---------------------------------------------

create table if not exists public.event_price_categories (
  event_id uuid not null references public.events (id) on delete cascade,
  price_category_id uuid not null references public.price_categories (id) on delete cascade,
  price numeric(10, 2) not null check (price >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (event_id, price_category_id)
);

create index if not exists event_price_categories_event_idx
  on public.event_price_categories (event_id);

drop trigger if exists trg_event_price_categories_updated_at on public.event_price_categories;
create trigger trg_event_price_categories_updated_at
  before update on public.event_price_categories
  for each row execute function public.update_updated_at_column();

-- --- Prístupové práva ---------------------------------------------------
-- Ceny zón musí vidieť aj neprihlásený návštevník — zákaznícka mapa podľa nich
-- vypisuje cenu sedadla. Keby ich nevidel, ukázala by inú sumu, než server
-- naozaj naúčtuje.

alter table public.price_categories enable row level security;
alter table public.event_price_categories enable row level security;

drop policy if exists price_categories_public_select on public.price_categories;
create policy price_categories_public_select on public.price_categories
  for select to anon, authenticated using (true);

drop policy if exists price_categories_admin_write on public.price_categories;
create policy price_categories_admin_write on public.price_categories
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists event_price_categories_public_select on public.event_price_categories;
create policy event_price_categories_public_select on public.event_price_categories
  for select to anon, authenticated using (true);

-- Ceny svojho podujatia mení jeho organizátor, admin všetky.
drop policy if exists event_price_categories_owner_write on public.event_price_categories;
create policy event_price_categories_owner_write on public.event_price_categories
  for all to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_price_categories.event_id
        and (e.organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role))
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_price_categories.event_id
        and (e.organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role))
    )
  );

grant select on public.price_categories to anon, authenticated;
grant insert, update, delete on public.price_categories to authenticated;
grant select on public.event_price_categories to anon, authenticated;
grant insert, update, delete on public.event_price_categories to authenticated;
