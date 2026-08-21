-- Objednávka si pamätá, ktorou bránou sa platí. Doteraz to bolo natvrdo
-- GoPay (stĺpce gopay_payment_id / gopay_payment_url). Tie necháme tak kvôli
-- histórii, ale nové platby píšu do generických stĺpcov.
alter table public.orders
  add column if not exists payment_provider public.payment_provider,
  add column if not exists payment_ref text,
  add column if not exists payment_url text,
  add column if not exists payment_vs bigint;

comment on column public.orders.payment_provider is
  'Brána, cez ktorú sa platí táto objednávka.';
comment on column public.orders.payment_ref is
  'Identifikátor platby u brány. GoPay: payment id, tatrapay+: paymentId, GP webpay: ORDERNUMBER.';
comment on column public.orders.payment_url is
  'Adresa, na ktorú sa presmeruje zákazník.';
comment on column public.orders.payment_vs is
  'Číselný variabilný symbol / ORDERNUMBER. GP webpay vyžaduje číslo a odmieta duplicitné.';

-- GP webpay chce číselné ORDERNUMBER, ktoré sa nesmie opakovať, a tatrapay+
-- číselný variabilný symbol do 10 číslic. UUID objednávky ani jedno nespĺňa.
create sequence if not exists public.payment_ref_seq as bigint start with 1000001 maxvalue 9999999999 no cycle;

revoke all on sequence public.payment_ref_seq from public, anon, authenticated;
grant usage on sequence public.payment_ref_seq to service_role;

-- Historické objednávky nech nevyzerajú, že nemajú bránu.
update public.orders
   set payment_provider = 'gopay',
       payment_ref = gopay_payment_id,
       payment_url = gopay_payment_url
 where gopay_payment_id is not null
   and payment_provider is null;

create index if not exists orders_payment_ref_idx
  on public.orders (payment_provider, payment_ref)
  where payment_ref is not null;

-- Sekvenciu z aplikácie nedosiahneme priamo (PostgREST vie volať len funkcie),
-- preto na pridelenie čísla platby jednoriadková funkcia.
create or replace function public.next_payment_ref()
returns bigint language sql security definer set search_path = public as $$
  select nextval('public.payment_ref_seq');
$$;

revoke all on function public.next_payment_ref() from public, anon, authenticated;
grant execute on function public.next_payment_ref() to service_role;
