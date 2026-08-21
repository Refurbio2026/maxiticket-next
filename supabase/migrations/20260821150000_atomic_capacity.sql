-- Kapacita pri státí sa kontroluje atomicky.
--
-- CHYBA: doteraz sa najprv spočítala obsadenosť a až potom vznikla objednávka.
-- Medzi tým bola diera: dvaja súbežní kupujúci obaja videli „zostáva 5", obaja
-- si vzali 5 a predalo sa 10. Pri sedadlách problém nie je — `reserve_seats` je
-- jeden atómický príkaz — ale státie a typy vstupeniek takú ochranu nemali.
--
-- Riešenie má dve časti:
--
--  1. Zámok na riadku termínu. Kým ho jedna objednávka drží, druhá sem nevojde
--     a po jeho uvoľnení už vidí zapísané položky tej prvej.
--
--  2. Rozhodnutie remízy podľa poradia vzniku objednávky. Keby sme len spočítali
--     všetko, obe súbežné objednávky by videli súčet nad kapacitou a padli by
--     obe — hoci jedna sa zmestí. Preto sa započítavajú len objednávky, ktoré
--     vznikli skôr (a táto). Prejde presne tá staršia.
--
-- Volá sa až po zápise položiek; keď vyhodí chybu, aplikácia objednávku zmaže
-- rovnako, ako to už robí pri obsadených sedadlách.
create or replace function public.assert_order_capacity(p_order_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_order   record;
  v_skupina record;
  v_kapacita int;
  v_obsadene int;
begin
  select o.id, o.event_id, o.event_date_id, o.created_at
    into v_order
    from public.orders o
   where o.id = p_order_id;
  if not found then
    raise exception 'ORDER_NOT_FOUND';
  end if;

  -- Zámok, ktorý súbežné objednávky zoradí za sebou.
  perform 1 from public.event_dates where id = v_order.event_date_id for update;

  for v_skupina in
    select i.ticket_type_id, sum(i.quantity)::int as ziadane
      from public.order_items i
     where i.order_id = p_order_id
       and i.seat_id is null          -- sedadlá si kapacitu strážia samy
     group by i.ticket_type_id
  loop
    if v_skupina.ticket_type_id is not null then
      select coalesce(tt.quantity, 0) into v_kapacita
        from public.ticket_types tt
       where tt.id = v_skupina.ticket_type_id;
    else
      -- Kapacita termínu má prednosť pred kapacitou podujatia.
      select coalesce(d.total_tickets, e.total_tickets, 0) into v_kapacita
        from public.event_dates d
        join public.events e on e.id = d.event_id
       where d.id = v_order.event_date_id;
    end if;

    -- 0 = kapacita nie je nastavená, nelimitujeme.
    if coalesce(v_kapacita, 0) <= 0 then
      continue;
    end if;

    select coalesce(sum(i.quantity), 0)::int into v_obsadene
      from public.order_items i
      join public.orders o on o.id = i.order_id
     where o.event_date_id = v_order.event_date_id
       and o.status in ('pending'::order_status,
                        'awaiting_payment'::order_status,
                        'paid'::order_status)
       and i.seat_id is null
       and i.ticket_type_id is not distinct from v_skupina.ticket_type_id
       and (o.created_at < v_order.created_at
            or (o.created_at = v_order.created_at and o.id <= v_order.id));

    if v_obsadene > v_kapacita then
      -- Koľko bolo voľných tesne pred touto objednávkou.
      raise exception 'CAPACITY_EXCEEDED:%',
        greatest(0, v_kapacita - (v_obsadene - v_skupina.ziadane))
        using errcode = 'P0001';
    end if;
  end loop;
end;
$$;

revoke all on function public.assert_order_capacity(uuid) from public, anon, authenticated;
grant execute on function public.assert_order_capacity(uuid) to service_role;
