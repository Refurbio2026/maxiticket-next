-- Držanie sedadla pri výbere — na serveri, nie v prehliadači.
--
-- Doteraz sa výber sedadla zapisoval do `localStorage` (stará vrstva
-- `ticketing-db.ts`), takže o ňom nikto iný nevedel. Dvaja kupujúci mohli
-- vybrať to isté miesto, obaja vyplnili údaje a druhý dostal „sedadlo si vzal
-- iný kupujúci" až pri odoslaní objednávky. Pri nápore je to to najhoršie
-- miesto, kde môže človek naraziť.
--
-- Odteraz sa sedadlo drží v `seat_inventory` hneď pri kliknutí — bez
-- objednávky, len s identifikátorom nákupnej relácie a krátkou platnosťou.
-- Ostatní ho tak uvidia obsadené.

alter table public.seat_inventory
  add column if not exists hold_session text;

comment on column public.seat_inventory.hold_session is
  'Nákupná relácia, ktorá sedadlo drží pri výbere. NULL = riadok patrí objednávke.';

-- Uvoľňovanie a preberanie vlastných držaní chodí vždy cez túto dvojicu.
create index if not exists seat_inventory_hold_idx
  on public.seat_inventory (event_date_id, hold_session)
  where hold_session is not null;

-- --------------------------------------------------------------------------
-- Podržanie sedadiel pri výbere
-- --------------------------------------------------------------------------

create or replace function public.hold_seats(
  p_event_id uuid,
  p_event_date_id uuid,
  p_session text,
  p_seats jsonb,
  p_until timestamptz)
returns table(seat_id text)
language plpgsql
security definer
set search_path to 'public'
as $function$
-- Návratový stĺpec sa volá rovnako ako stĺpec tabuľky; toto hovorí, že
-- v tele funkcie má prednosť stĺpec (kvôli `on conflict (event_date_id, seat_id)`).
#variable_conflict use_column
begin
  if jsonb_array_length(p_seats) = 0 or coalesce(p_session, '') = '' then
    return;
  end if;

  insert into public.seat_inventory
    (event_id, event_date_id, seat_id, status, price, label, is_vip,
     order_id, hold_session, reserved_until)
  select
    p_event_id, p_event_date_id, s ->> 'seat_id', 'reserved'::seat_status,
    (s ->> 'price')::numeric, s ->> 'label',
    coalesce((s ->> 'is_vip')::boolean, false),
    null, p_session, p_until
  from jsonb_array_elements(p_seats) s
  on conflict (event_date_id, seat_id) do update
    set status = 'reserved'::seat_status,
        price = excluded.price,
        label = excluded.label,
        is_vip = excluded.is_vip,
        order_id = null,
        hold_session = excluded.hold_session,
        reserved_until = excluded.reserved_until
    -- Prevziať sa smie len voľné miesto, vlastné držanie, alebo cudzie
    -- držanie či rezervácia, ktorým už vypršala platnosť. Predané sedadlo
    -- sem nespadne, to má stav `sold`.
    where seat_inventory.status = 'available'::seat_status
       or seat_inventory.hold_session = p_session
       or (seat_inventory.status = 'reserved'::seat_status
           and (seat_inventory.reserved_until is null
                or seat_inventory.reserved_until <= now()));

  -- Vraciame, čo sa naozaj podarilo získať — volajúci si porovná so žiadaným.
  return query
    select si.seat_id
      from public.seat_inventory si
     where si.event_date_id = p_event_date_id
       and si.hold_session = p_session
       and si.seat_id in (select s ->> 'seat_id' from jsonb_array_elements(p_seats) s);
end;
$function$;

grant execute on function public.hold_seats(uuid, uuid, text, jsonb, timestamptz) to service_role;

-- --------------------------------------------------------------------------
-- Uvoľnenie držaných sedadiel
-- --------------------------------------------------------------------------

-- `p_seat_id` NULL uvoľní všetko, čo relácia na tom termíne drží.
-- Maže sa len držanie (`order_id is null`) — rezervácie objednávok sa nedotýka.
create or replace function public.release_holds(
  p_event_date_id uuid,
  p_session text,
  p_seat_id text default null)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_zmazane int;
begin
  if coalesce(p_session, '') = '' then
    return 0;
  end if;

  delete from public.seat_inventory
   where event_date_id = p_event_date_id
     and hold_session = p_session
     and order_id is null
     and (p_seat_id is null or seat_id = p_seat_id);

  get diagnostics v_zmazane = row_count;
  return v_zmazane;
end;
$function$;

grant execute on function public.release_holds(uuid, text, text) to service_role;

-- --------------------------------------------------------------------------
-- Predĺženie platnosti držaných sedadiel
-- --------------------------------------------------------------------------

create or replace function public.extend_holds(
  p_event_date_id uuid,
  p_session text,
  p_until timestamptz)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pocet int;
begin
  if coalesce(p_session, '') = '' then
    return 0;
  end if;

  update public.seat_inventory
     set reserved_until = p_until
   where event_date_id = p_event_date_id
     and hold_session = p_session
     and order_id is null
     and status = 'reserved'::seat_status;

  get diagnostics v_pocet = row_count;
  return v_pocet;
end;
$function$;

grant execute on function public.extend_holds(uuid, text, timestamptz) to service_role;

-- --------------------------------------------------------------------------
-- Objednávka musí vedieť prevziať vlastné držanie
-- --------------------------------------------------------------------------

-- Nová podoba s reláciou. Pôvodná päťparametrová zostáva ako obal, aby počas
-- nasadzovania nič nespadlo — a keďže `p_session` tu nemá predvolenú hodnotu,
-- volanie sa nikdy nestane nejednoznačným.
create or replace function public.reserve_seats(
  p_event_id uuid,
  p_event_date_id uuid,
  p_order_id uuid,
  p_seats jsonb,
  p_reserved_until timestamptz,
  p_session text)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_claimed int;
  v_requested int := jsonb_array_length(p_seats);
begin
  if v_requested = 0 then
    return;
  end if;

  insert into public.seat_inventory
    (event_id, event_date_id, seat_id, status, price, label, is_vip,
     order_id, hold_session, reserved_until)
  select
    p_event_id, p_event_date_id, s ->> 'seat_id', 'reserved'::seat_status,
    (s ->> 'price')::numeric, s ->> 'label',
    coalesce((s ->> 'is_vip')::boolean, false),
    p_order_id, null, p_reserved_until
  from jsonb_array_elements(p_seats) s
  on conflict (event_date_id, seat_id) do update
    set status = 'reserved'::seat_status,
        price = excluded.price,
        label = excluded.label,
        is_vip = excluded.is_vip,
        order_id = excluded.order_id,
        hold_session = null,
        reserved_until = excluded.reserved_until
    where seat_inventory.status = 'available'::seat_status
       or seat_inventory.order_id = p_order_id
       -- Sedadlo, ktoré si ten istý kupujúci pred chvíľou vybral.
       or (p_session is not null and seat_inventory.hold_session = p_session)
       or (seat_inventory.status = 'reserved'::seat_status
           and (seat_inventory.reserved_until is null
                or seat_inventory.reserved_until <= now()));

  select count(*) into v_claimed
  from public.seat_inventory si
  where si.event_date_id = p_event_date_id
    and si.order_id = p_order_id
    and si.seat_id in (select s ->> 'seat_id' from jsonb_array_elements(p_seats) s);

  if v_claimed <> v_requested then
    raise exception 'SEATS_TAKEN' using errcode = 'P0001';
  end if;
end;
$function$;

grant execute on function public.reserve_seats(uuid, uuid, uuid, jsonb, timestamptz, text) to service_role;

-- Pôvodná podoba bez relácie — len presmeruje.
create or replace function public.reserve_seats(
  p_event_id uuid,
  p_event_date_id uuid,
  p_order_id uuid,
  p_seats jsonb,
  p_reserved_until timestamptz)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  select public.reserve_seats(p_event_id, p_event_date_id, p_order_id,
                              p_seats, p_reserved_until, null::text);
$function$;
