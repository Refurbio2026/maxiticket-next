-- Obsahové stránky verejného webu.
--
-- Statické stránky sa dali meniť len zásahom do kódu, takže obchodné podmienky
-- ani ochrana osobných údajov na webe vôbec neboli — a pätička odkazovala na
-- `/about`, ktoré neexistovalo. Stránka `/admin/data/content` taký zoznam
-- predstierala nad generovanými dátami.
--
-- Zámerne sem NEDOPĹŇAME žiadny text. Obchodné podmienky si musí napísať
-- prevádzkovateľ; vymyslený právny text by bol horší než žiadny. Preto sú
-- stránky založené prázdne a nepublikované — na web sa dostanú až keď ich
-- niekto naozaj napíše.

create table if not exists public.site_pages (
  id uuid primary key default gen_random_uuid(),
  slug text not null,
  title text not null,
  -- Jednoduchý text: prázdny riadok oddeľuje odsek, riadok s `## ` je nadpis.
  body text not null default '',
  meta_description text,
  -- Nepublikovaná stránka je na webe neviditeľná (vracia 404).
  published boolean not null default false,
  -- Zobrazovať v pätičke webu.
  show_in_footer boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists site_pages_slug_key on public.site_pages (slug);

drop trigger if exists trg_site_pages_updated_at on public.site_pages;
create trigger trg_site_pages_updated_at
  before update on public.site_pages
  for each row execute function public.update_updated_at_column();

-- Kostry stránok, ktoré ticketingová platforma potrebuje. Bez textu.
insert into public.site_pages (slug, title, sort_order)
values
  ('about', 'O nás', 10),
  ('obchodne-podmienky', 'Obchodné podmienky', 20),
  ('ochrana-osobnych-udajov', 'Ochrana osobných údajov', 30),
  ('reklamacny-poriadok', 'Reklamačný poriadok', 40)
on conflict (slug) do nothing;

alter table public.site_pages enable row level security;

-- Publikovanú stránku smie čítať ktokoľvek, rozpracovanú len admin.
drop policy if exists site_pages_public_select on public.site_pages;
create policy site_pages_public_select on public.site_pages
  for select to anon, authenticated
  using (published or public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists site_pages_admin_write on public.site_pages;
create policy site_pages_admin_write on public.site_pages
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

grant select on public.site_pages to anon, authenticated;
grant insert, update, delete on public.site_pages to authenticated;
grant all on public.site_pages to service_role;
