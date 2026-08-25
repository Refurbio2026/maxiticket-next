-- Zrušenie podujatia alebo jedného termínu: kedy, kým a prečo.
alter table public.events
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text,
  add column if not exists cancelled_by uuid references auth.users (id) on delete set null;

alter table public.event_dates
  add column if not exists cancelled_at timestamptz,
  add column if not exists cancel_reason text;

comment on column public.events.cancel_reason is
  'Dôvod zrušenia — ide zákazníkovi do e-mailu, takže je to text pre neho.';

-- Zrušené termíny sa už nesmú ponúkať na predaj; stav sa zapisuje aj sem,
-- lebo `event_dates.status` je bežný text a číta ho verejný katalóg.
create index if not exists event_dates_cancelled_idx
  on public.event_dates (event_id)
  where cancelled_at is not null;
