-- Koľko vstupeniek smie jeden človek kúpiť na jedno podujatie.
--
-- Globálny strop 20 kusov na objednávku už existuje, ale nebráni tomu, aby si
-- niekto kúpil dvadsať, zaplatil a hneď kúpil ďalších dvadsať. Pri vypredanom
-- koncerte je presne toto cesta, ako sála skončí u prekupníkov.
--
-- NULL = platí len globálny strop, teda dnešné správanie.
alter table public.events
  add column if not exists max_tickets_per_person integer;

comment on column public.events.max_tickets_per_person is
  'Strop vstupeniek na jednu e-mailovú adresu za celé podujatie. NULL = bez vlastného stropu.';

alter table public.events
  drop constraint if exists events_max_tickets_per_person_check;
alter table public.events
  add constraint events_max_tickets_per_person_check
  check (max_tickets_per_person is null or max_tickets_per_person > 0);
