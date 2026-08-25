-- Kedy odišla pripomienka pred podujatím.
--
-- Sken beží opakovane a musí vedieť, komu už písal — inak by pri každom behu
-- poslal ďalší e-mail. Rovnaký zámok ako `tickets_emailed_at` pri vstupenkách.
alter table public.orders
  add column if not exists reminder_sent_at timestamptz;

comment on column public.orders.reminder_sent_at is
  'Kedy odišla pripomienka pred podujatím. NULL = ešte neodišla.';

create index if not exists orders_reminder_pending_idx
  on public.orders (event_date_id)
  where status = 'paid' and reminder_sent_at is null;
