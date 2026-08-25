-- Čakačka na vypredané termíny.
--
-- Vypredané dnes znamená koniec: zákazník odíde a organizátor sa ani
-- nedozvie, že by sa oplatilo pridať termín.
create table if not exists public.waitlist (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  event_date_id uuid references public.event_dates (id) on delete cascade,
  email text not null,
  /** Koľko vstupeniek by chcel — nech vieme, či má zmysel ho volať. */
  wanted int not null default 1 check (wanted > 0 and wanted <= 20),
  notified_at timestamptz,
  created_at timestamptz not null default now()
);

-- Jeden e-mail sa na ten istý termín zapíše raz; opakovaný zápis len
-- aktualizuje počet.
create unique index if not exists waitlist_unique_idx
  on public.waitlist (event_id, coalesce(event_date_id, event_id), lower(email));

create index if not exists waitlist_pending_idx
  on public.waitlist (event_date_id)
  where notified_at is null;

alter table public.waitlist enable row level security;
revoke all on table public.waitlist from anon, authenticated;

comment on table public.waitlist is
  'Záujemcovia o vypredaný termín. Bez RLS politiky — píše a číta len service role cez serverové funkcie.';
