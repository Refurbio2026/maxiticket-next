-- Fáza 3: atomická rezervácia sedadiel + upratovanie expirovaných objednávok.
--
-- Doteraz `submitOrder` najprv SELECT-om overil obsadenosť a až potom urobil
-- UPSERT. Medzi tie dva dotazy sa zmestila súbežná objednávka a unique
-- constraint (event_id, seat_id) ju nezastavil, lebo upsert cudziu rezerváciu
-- prepísal. Pri nárazovom predaji sa tak jedno sedadlo predalo dvakrát.
--
-- Tu je celá operácia jeden príkaz: `on conflict do update ... where` vyhodnotí
-- podmienku atomicky nad zamknutým riadkom. Riadky, ktoré podmienkou neprejdú,
-- sa ticho preskočia — preto na konci overíme počet a pri nezhode vyhodíme
-- výnimku, ktorá zroluje celú funkciu.

create or replace function public.reserve_seats(
  p_event_id uuid,
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
    (event_id, seat_id, status, price, label, is_vip, order_id, reserved_until)
  select
    p_event_id,
    s ->> 'seat_id',
    'reserved'::seat_status,
    (s ->> 'price')::numeric,
    s ->> 'label',
    coalesce((s ->> 'is_vip')::boolean, false),
    p_order_id,
    p_reserved_until
  from jsonb_array_elements(p_seats) s
  on conflict (event_id, seat_id) do update
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
  where si.event_id = p_event_id
    and si.order_id = p_order_id
    and si.seat_id in (select s ->> 'seat_id' from jsonb_array_elements(p_seats) s);

  if v_claimed <> v_requested then
    raise exception 'SEATS_TAKEN' using errcode = 'P0001';
  end if;
end;
$$;

revoke execute on function public.reserve_seats(uuid, uuid, jsonb, timestamptz) from anon, authenticated, public;

-- Nedokončené objednávky sa doteraz neupratovali: ostávali navždy `pending`
-- a ich sedadlá v stave `reserved`, čo skresľovalo dostupnosť aj štatistiky.
create or replace function public.expire_stale_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_expired int;
begin
  with stale as (
    update public.orders
    set status = 'expired'::order_status
    where status in ('pending'::order_status, 'awaiting_payment'::order_status)
      and expires_at is not null
      and expires_at <= now()
    returning id
  )
  update public.seat_inventory si
  set status = 'available'::seat_status, reserved_until = null, order_id = null
  from stale
  where si.order_id = stale.id and si.status <> 'sold'::seat_status;

  get diagnostics v_expired = row_count;
  return v_expired;
end;
$$;

revoke execute on function public.expire_stale_orders() from anon, authenticated, public;

-- Rýchle dohľadanie už zabraných miest pri kontrole kapacity.
create index if not exists order_items_ticket_type_idx on public.order_items (ticket_type_id);
create index if not exists orders_status_idx on public.orders (status);
