-- Nastavenie ORP / eKasy malo v databáze len zlomok polí, ktoré formulár
-- pôvodne ponúkal (zvyšok žil v localStorage a po vymazaní cache zmizol).
-- Dopĺňame chýbajúce, aby sa dali zadať všetky údaje pre finančnú správu.

alter table public.fiscal_settings
  add column if not exists mode text not null default 'mock',
  add column if not exists fiscal_type text not null default 'ORP',
  add column if not exists ico text,
  add column if not exists premises_code text,
  add column if not exists premises_name text,
  add column if not exists premises_address text,
  -- Prístupy k bráne poskytovateľa ORP. Čítajú sa výhradne cez service-role
  -- server funkcie; RLS ich okrem vlastníka a admina nikomu nepustí.
  add column if not exists api_key text,
  add column if not exists client_id text,
  add column if not exists client_secret text;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'fiscal_settings_mode_check'
  ) then
    alter table public.fiscal_settings
      add constraint fiscal_settings_mode_check
      check (mode in ('mock', 'production'));
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'fiscal_settings_fiscal_type_check'
  ) then
    alter table public.fiscal_settings
      add constraint fiscal_settings_fiscal_type_check
      check (fiscal_type in ('ORP', 'eKasa'));
  end if;
end $$;

comment on column public.fiscal_settings.cash_register_code is
  'DKP — daňový kód pokladnice pridelený finančnou správou';
comment on column public.fiscal_settings.premises_code is
  'Kód prevádzky, na ktorú je pokladnica zaregistrovaná';
