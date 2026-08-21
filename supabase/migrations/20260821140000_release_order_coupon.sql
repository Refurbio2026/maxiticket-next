-- Zrušená a neúspešná platba vracia použitie kupónu.
--
-- CHYBA: `check_coupon(claim => true)` zvýši `coupons.used_count` hneď pri
-- vzniku objednávky a po jej dokončení pribudne riadok v `coupon_redemptions`.
-- Keď zákazník platbu v GoPay zruší (alebo mu ju banka zamietne), obe cesty
-- vysporiadania uvoľnia sedadlá, ale kupón nie. Dôsledok:
--   * `used_count` ostane zvýšený — kampaň so 100 použitiami minú aj tí, čo
--     nikdy nezaplatili,
--   * riadok uplatnenia ostane — a keďže `max_uses_per_email` sa počíta práve
--     z neho, zákazník si ten istý kupón už druhýkrát neuplatní, hoci
--     za nič nezaplatil.
--
-- Vraciame rovnakým spôsobom ako `expire_stale_orders`: zmažeme riadky
-- uplatnenia a počítadlo znížime presne o toľko, koľko ich naozaj zmizlo.
-- Vďaka tomu je funkcia idempotentná — opakovaná notifikácia z GoPay už
-- nezmaže nič a počítadlo nechá na pokoji.
create or replace function public.release_order_coupon(p_order_id uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_vratene int := 0;
begin
  -- Poistka: zaplatenej objednávke kupón nikdy neberieme.
  if exists (
    select 1 from public.orders o
    where o.id = p_order_id and o.status = 'paid'::order_status
  ) then
    return 0;
  end if;

  with removed as (
    delete from public.coupon_redemptions r
    where r.order_id = p_order_id
    returning r.coupon_id
  ),
  agg as (
    select coupon_id, count(*)::int as n from removed group by coupon_id
  ),
  upd as (
    update public.coupons c
       set used_count = greatest(0, c.used_count - agg.n)
      from agg
     where c.id = agg.coupon_id
    returning agg.n
  )
  select coalesce(sum(n), 0)::int into v_vratene from upd;

  return v_vratene;
end;
$$;

revoke all on function public.release_order_coupon(uuid) from public, anon, authenticated;
grant execute on function public.release_order_coupon(uuid) to service_role;
