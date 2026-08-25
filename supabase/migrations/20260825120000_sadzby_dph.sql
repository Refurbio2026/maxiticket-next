-- Sadzba DPH prestáva byť natvrdo 20 %.
--
-- Od 1. 1. 2025 je základná sadzba 23 %. Na vstupné pritom neplatí jedna
-- sadzba: divadlo, opera, balet, muzikál, bábkové divadlo, múzeá, výstavy
-- a športové podujatia majú 5 %, kým hudobné koncerty základnú sadzbu.
-- Preto sa dá nastaviť na konkrétnom podujatí.
alter table public.platform_settings
  add column if not exists default_vat_rate numeric(5, 2) not null default 23;

comment on column public.platform_settings.default_vat_rate is
  'Predvolená sadzba DPH v percentách. Použije sa, keď podujatie nemá vlastnú.';

alter table public.events
  add column if not exists vat_rate numeric(5, 2);

comment on column public.events.vat_rate is
  'Sadzba DPH pre vstupné na toto podujatie v percentách. NULL = predvolená sadzba platformy.';

-- Historické podujatia necháme na predvolenej sadzbe; meniť už vystavené
-- faktúry spätne by bola chyba.
