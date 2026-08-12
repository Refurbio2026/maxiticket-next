-- Fáza 3: pravidelné upratovanie nedokončených objednávok.
--
-- `submitOrder` volá `expire_stale_orders()` oportunisticky pri každom novom
-- nákupe, no na podujatí bez prevádzky by uviaznuté rezervácie držali sedadlá
-- ľubovoľne dlho. Cron to rieši nezávisle od návštevnosti.

create extension if not exists pg_cron with schema cron;

-- Idempotentne: pri opakovanom nasadení najprv zruš starú úlohu.
select cron.unschedule('expire-stale-orders')
where exists (select 1 from cron.job where jobname = 'expire-stale-orders');

select cron.schedule(
  'expire-stale-orders',
  '*/5 * * * *',
  $$select public.expire_stale_orders();$$
);
