-- Objednávka si pamätá aj staré variabilné symboly.
--
-- Prečo: zákazník si objedná s platbou prevodom, dostane VS a lehotu. Potom
-- si to rozmyslí a zaplatí kartou — a `startPaymentForOrder` mu pridelí nový
-- VS, lebo GP webpay odmieta zopakované ORDERNUMBER. Keby medzitým predsa
-- len odoslal aj prevod so starým symbolom, peniaze by prišli s variabilným
-- symbolom, ktorý už nepatrí nikomu: párovanie by objednávku nenašlo
-- a platba by skončila medzi nespárovanými.
--
-- Nájsť ju vtedy vieme — a rozhodne lepšie, než nechať človeka dohľadávať,
-- komu tie peniaze patria.

alter table public.orders
  add column if not exists previous_vs bigint[] not null default '{}'::bigint[];

comment on column public.orders.previous_vs is
  'Skôr pridelené variabilné symboly tejto objednávky. Párovanie podľa nich platbu '
  'stále nájde, hoci aktuálny VS je už iný.';

-- Vyhľadávanie v poli potrebuje GIN index; bez neho by párovanie prechádzalo
-- všetky objednávky.
create index if not exists orders_previous_vs_idx
  on public.orders using gin (previous_vs);
