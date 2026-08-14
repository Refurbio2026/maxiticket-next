-- Reklamné kampane a napojenie na reklamné účty.
--
-- Posledná vec, ktorá držala dáta v localStorage prehliadača: kampaň založená
-- na jednom počítači sa na druhom nezobrazila a po vymazaní cache zmizla aj
-- s rozpočtom. Prepojenie s Google Ads a Meta je stále len evidencia — reálne
-- API sa nevolá, takže metriky sú tie, ktoré niekto zapíše.

create table if not exists public.ad_accounts (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references auth.users (id) on delete cascade,
  platform text not null check (platform in ('google', 'meta')),
  -- Google: customer_id; Meta: ad_account_id.
  account_id text not null,
  account_name text,
  -- Meta navyše: business účet, pixel a stránka.
  business_account_id text,
  pixel_id text,
  page_name text,
  status text not null default 'connected' check (status in ('connected', 'disconnected')),
  credit_eur numeric(12, 2) not null default 0,
  last_sync_at timestamptz,
  connected_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists ad_accounts_unique
  on public.ad_accounts (organizer_id, platform, account_id);

drop trigger if exists trg_ad_accounts_updated_at on public.ad_accounts;
create trigger trg_ad_accounts_updated_at
  before update on public.ad_accounts
  for each row execute function public.update_updated_at_column();

-- Meracie kódy na web organizátora; jeden riadok na organizátora.
create table if not exists public.pixel_settings (
  organizer_id uuid primary key references auth.users (id) on delete cascade,
  ga4_measurement_id text,
  gtm_id text,
  google_ads_conversion_id text,
  google_ads_conversion_label text,
  meta_pixel_id text,
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_pixel_settings_updated_at on public.pixel_settings;
create trigger trg_pixel_settings_updated_at
  before update on public.pixel_settings
  for each row execute function public.update_updated_at_column();

create table if not exists public.ad_campaigns (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid references public.events (id) on delete set null,
  platform text not null check (platform in ('google', 'meta')),
  name text not null,
  goal text not null default 'sales'
    check (goal in ('sales', 'traffic', 'remarketing', 'awareness')),
  budget_eur numeric(12, 2) not null default 0,
  status text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'ended')),
  -- Cielenie a kreatíva sú voľné štruktúry (mestá, záujmy, texty, obrázky),
  -- nedotazujeme sa do nich — preto JSONB a nie ďalšie tabuľky.
  audience jsonb not null default '{}'::jsonb,
  creative jsonb not null default '{}'::jsonb,
  -- Výkon kampane; kým nie je napojené API, zapisuje ho človek.
  impressions integer not null default 0,
  clicks integer not null default 0,
  spend_eur numeric(12, 2) not null default 0,
  conversions integer not null default 0,
  revenue_eur numeric(12, 2) not null default 0,
  auto_generated boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists ad_campaigns_organizer_idx
  on public.ad_campaigns (organizer_id, created_at desc);
create index if not exists ad_campaigns_event_idx on public.ad_campaigns (event_id);

drop trigger if exists trg_ad_campaigns_updated_at on public.ad_campaigns;
create trigger trg_ad_campaigns_updated_at
  before update on public.ad_campaigns
  for each row execute function public.update_updated_at_column();

-- --- Prístupové práva ---------------------------------------------------
-- Kampaň aj reklamný účet patria organizátorovi; admin vidí všetko.

alter table public.ad_accounts enable row level security;
alter table public.pixel_settings enable row level security;
alter table public.ad_campaigns enable row level security;

drop policy if exists ad_accounts_owner on public.ad_accounts;
create policy ad_accounts_owner on public.ad_accounts
  for all to authenticated
  using (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role))
  with check (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists pixel_settings_owner on public.pixel_settings;
create policy pixel_settings_owner on public.pixel_settings
  for all to authenticated
  using (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role))
  with check (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists ad_campaigns_owner on public.ad_campaigns;
create policy ad_campaigns_owner on public.ad_campaigns
  for all to authenticated
  using (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role))
  with check (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role));

grant select, insert, update, delete on public.ad_accounts to authenticated;
grant select, insert, update, delete on public.pixel_settings to authenticated;
grant select, insert, update, delete on public.ad_campaigns to authenticated;
