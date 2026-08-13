-- Náklady organizátorov.
--
-- Vyúčtovanie doteraz počítalo len tržbu mínus províziu. Reálne sa však
-- organizátorovi z výplaty sťahujú aj náklady, ktoré zaňho platforma vynaložila
-- — tlač vstupeniek, prenájom čítačiek, poštovné, dohodnutá reklama. Stránka
-- `/admin/maxiticket/costs` ich predstierala nad generovanými dátami.
--
-- Náklad sa viaže na organizátora a nepovinne na podujatie. Kým nie je zahrnutý
-- do protokolu, `settlement_id` je NULL — vtedy ho vyúčtovanie ponúkne na
-- odpočet. Pri vytvorení protokolu sa naň prepíše, takže sa neodpočíta dvakrát.

create table if not exists public.organizer_costs (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references auth.users(id) on delete restrict,
  event_id uuid references public.events(id) on delete set null,
  -- Naplnené až vtedy, keď náklad vstúpi do vyúčtovacieho protokolu.
  settlement_id uuid references public.settlements(id) on delete set null,
  title text not null,
  -- Kladná suma = sťahuje sa organizátorovi z výplaty.
  amount numeric(12, 2) not null check (amount > 0),
  cost_date date not null default current_date,
  note text,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists organizer_costs_organizer_idx on public.organizer_costs (organizer_id);
create index if not exists organizer_costs_settlement_idx on public.organizer_costs (settlement_id);
create index if not exists organizer_costs_date_idx on public.organizer_costs (cost_date desc);

drop trigger if exists trg_organizer_costs_updated_at on public.organizer_costs;
create trigger trg_organizer_costs_updated_at
  before update on public.organizer_costs
  for each row execute function public.update_updated_at_column();

-- Protokol si zmrazí aj súčet nákladov — neskoršia zmena nákladu už nesmie
-- prepísať sumu, ktorú organizátor odsúhlasil.
alter table public.settlements
  add column if not exists costs_amount numeric(12, 2) not null default 0;

alter table public.organizer_costs enable row level security;

-- Organizátor vidí svoje náklady (je to jeho výplata), zapisuje výhradne admin.
drop policy if exists organizer_costs_owner_select on public.organizer_costs;
create policy organizer_costs_owner_select on public.organizer_costs
  for select to authenticated
  using (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role));

drop policy if exists organizer_costs_admin_write on public.organizer_costs;
create policy organizer_costs_admin_write on public.organizer_costs
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

grant select on public.organizer_costs to authenticated;
grant insert, update, delete on public.organizer_costs to authenticated;
grant all on public.organizer_costs to service_role;
