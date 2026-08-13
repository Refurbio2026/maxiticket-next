-- Interné poznámky k objednávkam.
--
-- Doteraz nebolo kde si zapísať, čo sa okolo objednávky dialo — telefonát so
-- zákazníkom, dohodnutá výmena termínu, sľúbený refund. Stránka
-- `/admin/sales/notes` pritom taký zoznam predstierala nad generovanými dátami.
--
-- Poznámka je interná: zákazník ju nikdy nevidí, preto k nej nemá prístup
-- `anon` a číta ju len admin alebo organizátor daného podujatia.

create table if not exists public.order_notes (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  -- Autor ostáva aj po zmazaní účtu — poznámka bez pisateľa je stále dôkaz.
  author_id uuid references auth.users(id) on delete set null,
  body text not null,
  -- Pripnutá poznámka je varovanie, ktoré má vidieť každý, kto objednávku otvorí.
  pinned boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists order_notes_order_idx on public.order_notes (order_id);
create index if not exists order_notes_created_idx on public.order_notes (created_at desc);

drop trigger if exists trg_order_notes_updated_at on public.order_notes;
create trigger trg_order_notes_updated_at
  before update on public.order_notes
  for each row execute function public.update_updated_at_column();

alter table public.order_notes enable row level security;

-- Čítať smie admin a organizátor podujatia, ku ktorému objednávka patrí.
drop policy if exists order_notes_read on public.order_notes;
create policy order_notes_read on public.order_notes
  for select to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::app_role)
    or exists (
      select 1 from public.orders o
      join public.events e on e.id = o.event_id
      where o.id = order_notes.order_id and e.organizer_id = auth.uid()
    )
  );

drop policy if exists order_notes_write on public.order_notes;
create policy order_notes_write on public.order_notes
  for all to authenticated
  using (
    public.has_role(auth.uid(), 'admin'::app_role)
    or exists (
      select 1 from public.orders o
      join public.events e on e.id = o.event_id
      where o.id = order_notes.order_id and e.organizer_id = auth.uid()
    )
  )
  with check (
    public.has_role(auth.uid(), 'admin'::app_role)
    or exists (
      select 1 from public.orders o
      join public.events e on e.id = o.event_id
      where o.id = order_notes.order_id and e.organizer_id = auth.uid()
    )
  );

grant select, insert, update, delete on public.order_notes to authenticated;
grant all on public.order_notes to service_role;
