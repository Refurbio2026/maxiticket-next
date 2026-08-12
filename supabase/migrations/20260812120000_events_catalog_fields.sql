-- Fáza 2: presun katalógu podujatí z localStorage do databázy.
--
-- Typ `EventItem` v src/lib/local-db.ts nesie polia, ktoré tabuľka `events`
-- zatiaľ nemá. Dopĺňame ich, aby sa katalóg dal čítať a zapisovať zo Supabase.

create type public.sale_type as enum ('standing', 'seating', 'seating_map');

alter table public.events
  add column if not exists address text,
  add column if not exists sale_type public.sale_type not null default 'standing',
  add column if not exists venue_layout_id text,
  add column if not exists base_price numeric(10, 2),
  add column if not exists total_tickets integer,
  add column if not exists vip_price numeric(10, 2);

-- DÔLEŽITÉ: migrácia 20260727120000 odobrala roli `anon` tabuľkový SELECT a dala
-- jej stĺpcový grant bez `scanner_token`. Nové stĺpce do toho grantu nespadajú
-- automaticky, takže ich treba povoliť explicitne — inak by verejný katalóg
-- spadol na 42501, len čo by si o ne požiadal.
grant select (address, sale_type, venue_layout_id, base_price, total_tickets, vip_price)
  on public.events to anon;

-- Katalóg sa filtruje podľa mesta a kategórie, radí sa podľa dátumu.
create index if not exists events_city_idx on public.events (city);
create index if not exists events_category_idx on public.events (category);
