-- Fakturačný systém sa dá vybrať rovnako ako platobná brána.
--
-- Úložisko prístupov prestáva byť len platobné, preto dostáva všeobecný názov
-- a textový `provider`. Enum by pri každom novom systéme znamenal migráciu.
alter table if exists public.payment_credentials rename to integration_credentials;
alter table public.integration_credentials alter column provider type text;

comment on table public.integration_credentials is
  'Šifrované prístupy k externým systémom (platobné brány, fakturácia). Bez RLS politiky — čítať a písať smie len service role.';

drop trigger if exists trg_payment_credentials_updated_at on public.integration_credentials;
drop trigger if exists trg_integration_credentials_updated_at on public.integration_credentials;
create trigger trg_integration_credentials_updated_at
  before update on public.integration_credentials
  for each row execute function public.update_updated_at_column();

-- Ktorý systém vystavuje faktúry. NULL = SuperFaktúra, ako doteraz.
alter table public.payment_settings
  add column if not exists invoice_provider text;

-- Ktorý systém vystavil faktúru ku konkrétnej objednávke. Stĺpce
-- `superfaktura_*` sú historický názov a nesú údaje z ktoréhokoľvek systému.
alter table public.orders
  add column if not exists invoice_provider text;

comment on column public.orders.invoice_provider is
  'Fakturačný systém, ktorý vystavil faktúru (superfaktura / faktero).';
comment on column public.orders.superfaktura_invoice_id is
  'Id faktúry vo fakturačnom systéme podľa invoice_provider — názov stĺpca je historický.';
