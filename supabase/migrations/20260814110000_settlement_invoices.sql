-- Faktúra za províziu k vyúčtovaciemu protokolu.
--
-- Protokol doteraz províziu vypočítal, ale nikde sa nezaznamenalo, či bola
-- organizátorovi vyfakturovaná. Stránka „Zostavy / fakturovanie" taký prehľad
-- predstierala nad generovanými riadkami.
--
-- Faktúra sa dá buď vystaviť cez SuperFaktúru, alebo — keď organizátor
-- fakturuje z vlastného systému — zapísať ručne jej číslo. Preto je
-- `invoice_number` obyčajný text a nie väzba na poskytovateľa.

alter table public.settlements
  add column if not exists invoice_number text,
  add column if not exists invoice_id text,
  add column if not exists invoice_pdf_url text,
  add column if not exists invoiced_at timestamptz,
  -- 'superfaktura' = vystavené cez API, 'manual' = číslo zapísal človek.
  add column if not exists invoice_source text
    check (invoice_source is null or invoice_source in ('superfaktura', 'manual'));

create index if not exists settlements_invoiced_at_idx on public.settlements (invoiced_at desc);
