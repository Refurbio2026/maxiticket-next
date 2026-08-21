-- Prístupy k platobným bránam zadané v administrácii.
--
-- Hodnoty sú šifrované (AES-256-GCM) kľúčom, ktorý v databáze nie je —
-- odpis databázy teda sám o sebe nestačí na to, aby sa dalo platiť cudzím
-- účtom. Dešifrovať ich vie len server.
--
-- Zámerne bez RLS politiky: k tabuľke sa nedostane ani prihlásený admin
-- priamo cez API. Všetko ide cez serverové funkcie, ktoré rolu overia
-- a hodnoty nikdy nevrátia do prehliadača.
create table if not exists public.payment_credentials (
  provider public.payment_provider not null,
  kluc text not null,
  hodnota_sifrovana text not null,
  updated_by uuid references auth.users (id) on delete set null,
  updated_at timestamptz not null default now(),
  primary key (provider, kluc)
);

alter table public.payment_credentials enable row level security;

revoke all on table public.payment_credentials from anon, authenticated;

drop trigger if exists trg_payment_credentials_updated_at on public.payment_credentials;
create trigger trg_payment_credentials_updated_at
  before update on public.payment_credentials
  for each row execute function public.update_updated_at_column();

comment on table public.payment_credentials is
  'Šifrované prístupy k platobným bránam. Bez RLS politiky — čítať a písať smie len service role.';
