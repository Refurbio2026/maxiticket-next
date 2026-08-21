-- Nastavenia platobných brán, ktoré sa smú ukazovať a meniť v admine.
--
-- BEZPEČNOSŤ: prístupy (kľúče, client secret) sem nepatria — tie zostávajú
-- v secrets. V databáze je len to, čo môže admin vidieť aj prepnúť: či sa
-- brána zákazníkovi ponúka a ktorá je predvolená.
create table if not exists public.payment_settings (
  id boolean primary key default true,
  gopay_enabled boolean not null default true,
  gpwebpay_enabled boolean not null default true,
  tatrapayplus_enabled boolean not null default true,
  default_provider public.payment_provider,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  constraint payment_settings_single_row check (id)
);

insert into public.payment_settings (id) values (true) on conflict do nothing;

drop trigger if exists trg_payment_settings_updated_at on public.payment_settings;
create trigger trg_payment_settings_updated_at
  before update on public.payment_settings
  for each row execute function public.update_updated_at_column();

alter table public.payment_settings enable row level security;

-- Platobné brány sú vec platformy, nie organizátora.
drop policy if exists payment_settings_admin on public.payment_settings;
create policy payment_settings_admin on public.payment_settings
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));
