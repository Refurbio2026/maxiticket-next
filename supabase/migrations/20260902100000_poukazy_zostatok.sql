-- Darčekové poukazy sa čerpajú po častiach.
--
-- Kupón doteraz vedel len „koľkokrát sa smie použiť". Na zľavový kód to stačí,
-- na darčekový poukaz nie: poukaz na 50 € minutý na lístok za 12 € by prepadol
-- aj so zvyšnými 38 €. Preto pribúda `remaining_amount` — živý zostatok.
--
-- Kupón bez `remaining_amount` sa správa presne ako doteraz. Zostatok teda
-- nemení nič existujúcim zľavovým kódom, zapína sa len tam, kde je vyplnený.

alter table public.coupons
  add column if not exists remaining_amount numeric;

comment on column public.coupons.remaining_amount is
  'Zostatok darčekového poukazu v EUR. NULL = bežný kupón, vyčerpanie riadi max_uses.';

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conrelid = 'public.coupons'::regclass
       and conname = 'coupons_remaining_amount_check'
  ) then
    alter table public.coupons
      add constraint coupons_remaining_amount_check
      check (remaining_amount is null or remaining_amount >= 0);
  end if;
end $$;

-- --------------------------------------------------------------------------
-- Overenie a čerpanie
-- --------------------------------------------------------------------------

create or replace function public.check_coupon(
  p_code text, p_event_id uuid, p_amount numeric,
  p_email text default null, p_claim boolean default false)
returns table(coupon_id uuid, discount numeric, error_code text)
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  c public.coupons%rowtype;
  v_owner uuid;
  v_used int;
  v_disc numeric;
  v_today date := (now() at time zone 'Europe/Bratislava')::date;
begin
  select * into c from public.coupons
   where upper(code) = upper(btrim(p_code))
   for update;

  if not found then
    return query select null::uuid, 0::numeric, 'not_found'::text;
    return;
  end if;

  if c.status <> 'active' then
    return query select c.id, 0::numeric, 'inactive'::text;
    return;
  end if;

  if c.valid_from is not null and v_today < c.valid_from then
    return query select c.id, 0::numeric, 'not_yet'::text;
    return;
  end if;

  if c.valid_until is not null and v_today > c.valid_until then
    return query select c.id, 0::numeric, 'expired'::text;
    return;
  end if;

  -- Kupón viazaný na podujatie platí len naň; kupón organizátora na všetky
  -- jeho podujatia; kupón bez organizátora (od admina) na čokoľvek.
  if c.event_id is not null then
    if c.event_id is distinct from p_event_id then
      return query select c.id, 0::numeric, 'wrong_event'::text;
      return;
    end if;
  elsif c.organizer_id is not null then
    select organizer_id into v_owner from public.events where id = p_event_id;
    if v_owner is distinct from c.organizer_id then
      return query select c.id, 0::numeric, 'wrong_event'::text;
      return;
    end if;
  end if;

  if c.min_order_amount > 0 and p_amount < c.min_order_amount then
    return query select c.id, 0::numeric, 'min_amount'::text;
    return;
  end if;

  -- Poukaz so zostatkom je vyčerpaný vtedy, keď na ňom nič nezostalo —
  -- počet použití ho neobmedzuje, lebo sa smie míňať po častiach.
  if c.remaining_amount is not null then
    if c.remaining_amount <= 0 then
      return query select c.id, 0::numeric, 'exhausted'::text;
      return;
    end if;
  elsif coalesce(c.max_uses, 0) > 0 and c.used_count >= c.max_uses then
    return query select c.id, 0::numeric, 'exhausted'::text;
    return;
  end if;

  if coalesce(c.max_uses_per_email, 0) > 0 and p_email is not null then
    select count(*) into v_used
      from public.coupon_redemptions r
     where r.coupon_id = c.id and lower(r.email) = lower(p_email);
    if v_used >= c.max_uses_per_email then
      return query select c.id, 0::numeric, 'email_limit'::text;
      return;
    end if;
  end if;

  if c.discount_type = 'percent' then
    v_disc := round(p_amount * c.discount_value / 100, 2);
  elsif c.remaining_amount is not null then
    v_disc := c.remaining_amount;
  else
    v_disc := c.discount_value;
  end if;
  if v_disc > p_amount then v_disc := p_amount; end if;

  if p_claim then
    update public.coupons
       set used_count = used_count + 1,
           remaining_amount = case
             when remaining_amount is not null then remaining_amount - v_disc
             else remaining_amount
           end
     where id = c.id;
  end if;

  return query select c.id, v_disc, null::text;
end;
$function$;

-- --------------------------------------------------------------------------
-- Vrátenie použitia
-- --------------------------------------------------------------------------

-- Pribudol druhý parameter, tak sa stará podoba musí najprv odstrániť —
-- inak by bolo volanie s jedným argumentom nejednoznačné.
drop function if exists public.release_coupon(uuid);

create or replace function public.release_coupon(
  p_coupon_id uuid, p_amount numeric default null)
returns void
language sql
security definer
set search_path to 'public'
as $function$
  update public.coupons
     set used_count = greatest(0, used_count - 1),
         remaining_amount = case
           when remaining_amount is not null and p_amount is not null
             then remaining_amount + p_amount
           else remaining_amount
         end
   where id = p_coupon_id;
$function$;

grant execute on function public.release_coupon(uuid, numeric) to service_role;

create or replace function public.release_order_coupon(p_order_id uuid)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
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
    returning r.coupon_id, r.discount_amount
  ),
  agg as (
    select coupon_id, count(*)::int as n,
           coalesce(sum(discount_amount), 0) as suma
      from removed group by coupon_id
  ),
  upd as (
    update public.coupons c
       set used_count = greatest(0, c.used_count - agg.n),
           remaining_amount = case
             when c.remaining_amount is not null then c.remaining_amount + agg.suma
             else c.remaining_amount
           end
      from agg
     where c.id = agg.coupon_id
    returning agg.n
  )
  select coalesce(sum(n), 0)::int into v_vratene from upd;

  return v_vratene;
end;
$function$;

-- --------------------------------------------------------------------------
-- Prenesené poukazy prepnúť na čerpanie po častiach
-- --------------------------------------------------------------------------

update public.coupons
   set remaining_amount = discount_value,
       max_uses = null
 where note like 'Prenesené zo starého systému%'
   and remaining_amount is null;
