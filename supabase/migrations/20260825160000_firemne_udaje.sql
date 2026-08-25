-- Firemné údaje kupujúceho.
--
-- Doteraz sa zbieralo len meno, e-mail a telefón, takže kto kupoval lístky na
-- firmu, nedostal použiteľnú faktúru. Faktero aj SuperFaktúra tie polia majú,
-- chýbali len u nás.
alter table public.orders
  add column if not exists customer_company text,
  add column if not exists customer_ico text,
  add column if not exists customer_dic text,
  add column if not exists customer_ic_dph text,
  add column if not exists customer_street text,
  add column if not exists customer_city text,
  add column if not exists customer_zip text,
  add column if not exists customer_country text;

comment on column public.orders.customer_company is
  'Názov firmy. Keď je vyplnený, faktúra ide na firmu a nie na fyzickú osobu.';
