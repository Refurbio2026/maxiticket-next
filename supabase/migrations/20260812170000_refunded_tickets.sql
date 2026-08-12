-- Refundovaná vstupenka má mať vlastný stav.
--
-- Doteraz ju `refundOrder` zneplatnil tak, že jej nastavil `used_at` na aktuálny
-- čas. Vstup to zablokovalo správne, ale personál pri bráne videl „už bola
-- použitá" namiesto „refundovaná" a zbytočne riešil spor so zákazníkom.
-- Zároveň to skresľovalo štatistiky — refundované lístky sa počítali medzi
-- použité.

alter table public.tickets
  add column if not exists refunded_at timestamptz;

create index if not exists tickets_refunded_idx on public.tickets (refunded_at)
  where refunded_at is not null;

-- Nová hodnota pre výsledok skenu. ALTER TYPE ... ADD VALUE nesmie byť
-- v transakcii spolu s použitím tej hodnoty, preto je migrácia samostatná.
alter type public.ticket_scan_result add value if not exists 'refunded';
