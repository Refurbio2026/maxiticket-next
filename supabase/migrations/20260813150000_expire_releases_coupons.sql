-- Vypršaná objednávka vracia aj použitie kupónu.
--
-- `submitOrder` si kupón nárokuje hneď pri zakladaní objednávky — inak by dvaja
-- súbežní kupujúci minuli to isté posledné použitie. Keď však objednávka
-- nedôjde k zaplateniu a vyprší, použitie musí ísť späť; bez toho by sa dal
-- kupón s limitom vyčerpať samotným zakladaním nedoplatených objednávok.
--
-- Sedadlá už uvoľňoval `expire_stale_orders`, kupóny doň pribúdajú teraz.
-- Návratová hodnota je odteraz počet objednávok (predtým to bol počet
-- uvoľnených sedadiel, čo názvu funkcie neodpovedalo).

create or replace function public.expire_stale_orders()
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_ids uuid[];
begin
  with stale as (
    update public.orders
    set status = 'expired'::order_status
    where status in ('pending'::order_status, 'awaiting_payment'::order_status)
      and expires_at is not null
      and expires_at <= now()
    returning id
  )
  select coalesce(array_agg(id), '{}'::uuid[]) into v_ids from stale;

  if array_length(v_ids, 1) is null then
    delete from public.rate_limits where window_start < now() - interval '2 days';
    return 0;
  end if;

  update public.seat_inventory si
  set status = 'available'::seat_status, reserved_until = null, order_id = null
  where si.order_id = any (v_ids) and si.status <> 'sold'::seat_status;

  -- Uplatnenie sa zmaže a počítadlo na kupóne sa zníži o toľko, koľko riadkov
  -- naozaj zmizlo — nikdy pod nulu.
  with removed as (
    delete from public.coupon_redemptions r
    where r.order_id = any (v_ids)
    returning r.coupon_id
  ),
  agg as (
    select coupon_id, count(*)::int as n from removed group by coupon_id
  )
  update public.coupons c
  set used_count = greatest(0, c.used_count - agg.n)
  from agg
  where c.id = agg.coupon_id;

  delete from public.rate_limits where window_start < now() - interval '2 days';

  return array_length(v_ids, 1);
end;
$$;
