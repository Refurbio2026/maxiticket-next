-- Ochrana pred zablokovaním sály: limity na vytváranie objednávok.
--
-- `submitOrder` je verejná a rezervuje sedadlá na 15 minút. Bez limitu vie
-- skript držať celú sálu obsadenú donekonečna — či už zo zlomyseľnosti alebo
-- od prekupníkov. Cron na expiráciu to len tlmí.
--
-- Počítadlo s pevným oknom: bucket + začiatok okna tvoria kľúč, inkrement je
-- atomický cez `on conflict do update ... returning`, takže súbežné požiadavky
-- sa nemôžu pretlačiť cez limit.

create table if not exists public.rate_limits (
  bucket text not null,
  window_start timestamptz not null,
  count integer not null default 0,
  primary key (bucket, window_start)
);

create index if not exists rate_limits_window_idx on public.rate_limits (window_start);

alter table public.rate_limits enable row level security;
-- Žiadne politiky: pristupuje sa výhradne service_role klientom zo servera.
grant all on public.rate_limits to service_role;

/**
 * Zaráta jeden pokus a vráti true, ak sa ešte zmestil do limitu.
 * Okno je pevné (napr. celá hodina), nie kĺzavé — jednoduchšie a lacnejšie.
 */
create or replace function public.hit_rate_limit(
  p_bucket text,
  p_limit integer,
  p_window_seconds integer
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_window timestamptz;
  v_count integer;
begin
  v_window := to_timestamp(
    floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds
  );

  insert into public.rate_limits (bucket, window_start, count)
  values (p_bucket, v_window, 1)
  on conflict (bucket, window_start)
    do update set count = rate_limits.count + 1
  returning count into v_count;

  return v_count <= p_limit;
end;
$$;

revoke execute on function public.hit_rate_limit(text, integer, integer) from anon, authenticated, public;

-- Staré okná nemá zmysel držať; upratuje ich ten istý cron ako objednávky.
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

  delete from public.rate_limits where window_start < now() - interval '2 days';

  return v_expired;
end;
$$;

revoke execute on function public.expire_stale_orders() from anon, authenticated, public;
