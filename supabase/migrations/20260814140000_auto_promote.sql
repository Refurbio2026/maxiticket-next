-- Prepínač automatickej propagácie nových podujatí.
--
-- Patrí k marketingovým nastaveniam organizátora, preto ide do `pixel_settings`
-- a nie do vlastnej tabuľky — je to jeden boolean na organizátora.

alter table public.pixel_settings
  add column if not exists auto_promote boolean not null default false;
