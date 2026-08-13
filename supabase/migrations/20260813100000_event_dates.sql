-- Termíny podujatí: jedno podujatie, viac dátumov.
--
-- Doteraz mal každý dátum vlastné podujatie — reprízu koncertu si organizátor
-- musel naklikať znovu vrátane typov lístkov aj rozloženia sály, a kupujúci
-- videl v katalógu ten istý názov trikrát. Teraz je podujatie „čo sa hrá"
-- a termín „kedy sa to hrá".
--
-- Kľúčové: obsadenosť sedadiel, objednávky aj vstupenky sa viažu na TERMÍN,
-- nie na podujatie. Bez toho by rezervácia sedadla na piatok zablokovala to
-- isté sedadlo aj na sobotu.
--
-- `events.event_date` / `event_time` ostávajú — držia najbližší termín a udržiava
-- ich trigger nižšie. Vďaka tomu katalóg, PDF, e-maily aj admin zoznamy fungujú
-- ďalej bez zmeny a nemusíme naraz prepísať celú aplikáciu.

create table if not exists public.event_dates (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  event_date date not null,
  event_time time without time zone not null,
  -- Zrušený termín sa nedá kúpiť, ale ostáva v databáze aj s predanými
  -- vstupenkami — inak by sa stratila stopa po tom, čo treba refundovať.
  status text not null default 'on_sale' check (status in ('on_sale', 'cancelled')),
  -- Kapacita len pre tento termín; NULL = použije sa `events.total_tickets`.
  total_tickets integer check (total_tickets is null or total_tickets >= 0),
  note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists event_dates_unique_slot
  on public.event_dates (event_id, event_date, event_time);
create index if not exists event_dates_event_idx on public.event_dates (event_id);
create index if not exists event_dates_date_idx on public.event_dates (event_date);

drop trigger if exists trg_event_dates_updated_at on public.event_dates;
create trigger trg_event_dates_updated_at
  before update on public.event_dates
  for each row execute function public.update_updated_at_column();

-- Každé existujúce podujatie dostane svoj termín z dátumu, ktorý už má.
-- Nikdy nesmie vzniknúť stav „podujatie bez termínu" — nedalo by sa kúpiť.
insert into public.event_dates (event_id, event_date, event_time)
select e.id, e.event_date, e.event_time
from public.events e
where not exists (select 1 from public.event_dates d where d.event_id = e.id);

-- --- Naviazanie predaja na termín ---------------------------------------

alter table public.seat_inventory
  add column if not exists event_date_id uuid references public.event_dates (id) on delete cascade;
alter table public.orders
  add column if not exists event_date_id uuid references public.event_dates (id) on delete restrict;
alter table public.tickets
  add column if not exists event_date_id uuid references public.event_dates (id) on delete restrict;

-- Doplnenie termínu do existujúcich riadkov. V tejto chvíli má každé podujatie
-- práve jeden termín, takže priradenie je jednoznačné.
update public.seat_inventory si
set event_date_id = d.id
from public.event_dates d
where d.event_id = si.event_id and si.event_date_id is null;

update public.orders o
set event_date_id = d.id
from public.event_dates d
where d.event_id = o.event_id and o.event_date_id is null;

update public.tickets t
set event_date_id = d.id
from public.event_dates d
where d.event_id = t.event_id and t.event_date_id is null;

alter table public.seat_inventory alter column event_date_id set not null;
alter table public.orders alter column event_date_id set not null;
alter table public.tickets alter column event_date_id set not null;

create index if not exists seat_inventory_event_date_idx on public.seat_inventory (event_date_id);
create index if not exists orders_event_date_idx on public.orders (event_date_id);
create index if not exists tickets_event_date_idx on public.tickets (event_date_id);

-- Jedno sedadlo je obsadené v rámci TERMÍNU, nie podujatia.
alter table public.seat_inventory drop constraint if exists seat_inventory_event_id_seat_id_key;
create unique index if not exists seat_inventory_date_seat_key
  on public.seat_inventory (event_date_id, seat_id);

-- --- Najbližší termín späť do podujatia ---------------------------------
-- Katalóg, PDF aj e-maily čítajú `events.event_date`. Aby nezostarel, po každej
-- zmene termínov doň zapíšeme najbližší budúci termín (a ak už všetky prebehli,
-- posledný odohraný) — teda to, čo má zmysel ukázať v zozname podujatí.

create or replace function public.sync_event_primary_date(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_date date;
  v_time time;
begin
  select d.event_date, d.event_time into v_date, v_time
  from public.event_dates d
  where d.event_id = p_event_id and d.status = 'on_sale'
  order by
    -- najprv budúce termíny vzostupne, potom minulé zostupne
    (d.event_date + d.event_time) >= now() desc,
    case when (d.event_date + d.event_time) >= now() then (d.event_date + d.event_time) end asc,
    (d.event_date + d.event_time) desc
  limit 1;

  if v_date is null then
    select d.event_date, d.event_time into v_date, v_time
    from public.event_dates d
    where d.event_id = p_event_id
    order by d.event_date desc, d.event_time desc
    limit 1;
  end if;

  if v_date is not null then
    update public.events
    set event_date = v_date, event_time = v_time
    where id = p_event_id and (event_date <> v_date or event_time <> v_time);
  end if;
end;
$$;

create or replace function public.trg_sync_event_primary_date()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.sync_event_primary_date(coalesce(new.event_id, old.event_id));
  return null;
end;
$$;

drop trigger if exists trg_event_dates_sync_event on public.event_dates;
create trigger trg_event_dates_sync_event
  after insert or update or delete on public.event_dates
  for each row execute function public.trg_sync_event_primary_date();

-- --- Rezervácia sedadiel po termínoch -----------------------------------
-- Rovnaká atómová logika ako predtým, len sa `on conflict` opiera o termín.
-- Podrobné odôvodnenie je v migrácii 20260812130000.

drop function if exists public.reserve_seats(uuid, uuid, jsonb, timestamptz);

create or replace function public.reserve_seats(
  p_event_id uuid,
  p_event_date_id uuid,
  p_order_id uuid,
  p_seats jsonb,
  p_reserved_until timestamptz
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_claimed int;
  v_requested int := jsonb_array_length(p_seats);
begin
  if v_requested = 0 then
    return;
  end if;

  insert into public.seat_inventory
    (event_id, event_date_id, seat_id, status, price, label, is_vip, order_id, reserved_until)
  select
    p_event_id,
    p_event_date_id,
    s ->> 'seat_id',
    'reserved'::seat_status,
    (s ->> 'price')::numeric,
    s ->> 'label',
    coalesce((s ->> 'is_vip')::boolean, false),
    p_order_id,
    p_reserved_until
  from jsonb_array_elements(p_seats) s
  on conflict (event_date_id, seat_id) do update
    set status = 'reserved'::seat_status,
        price = excluded.price,
        label = excluded.label,
        is_vip = excluded.is_vip,
        order_id = excluded.order_id,
        reserved_until = excluded.reserved_until
    where seat_inventory.status = 'available'::seat_status
       or seat_inventory.order_id = p_order_id
       or (seat_inventory.status = 'reserved'::seat_status
           and (seat_inventory.reserved_until is null or seat_inventory.reserved_until <= now()));

  select count(*) into v_claimed
  from public.seat_inventory si
  where si.event_date_id = p_event_date_id
    and si.order_id = p_order_id
    and si.seat_id in (select s ->> 'seat_id' from jsonb_array_elements(p_seats) s);

  if v_claimed <> v_requested then
    raise exception 'SEATS_TAKEN' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.reserve_seats(uuid, uuid, uuid, jsonb, timestamptz)
  from anon, authenticated, public;
revoke execute on function public.sync_event_primary_date(uuid) from anon, authenticated, public;

-- --- Prístupové práva ---------------------------------------------------
-- Termíny sú verejná informácia rovnako ako podujatie samo; koncepty vidí len
-- vlastník a admin, presne ako v `events_public_published_select`.

alter table public.event_dates enable row level security;

drop policy if exists event_dates_public_select on public.event_dates;
create policy event_dates_public_select on public.event_dates
  for select to anon, authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_dates.event_id
        and (
          e.status = 'published'::event_status
          or e.organizer_id = auth.uid()
          or public.has_role(auth.uid(), 'admin'::app_role)
        )
    )
  );

drop policy if exists event_dates_owner_write on public.event_dates;
create policy event_dates_owner_write on public.event_dates
  for all to authenticated
  using (
    exists (
      select 1 from public.events e
      where e.id = event_dates.event_id
        and (e.organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role))
    )
  )
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_dates.event_id
        and (e.organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role))
    )
  );

grant select on public.event_dates to anon, authenticated;
grant insert, update, delete on public.event_dates to authenticated;
