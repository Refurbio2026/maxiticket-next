-- Storno a refundácie ako záznam na objednávke.
--
-- Doteraz sa refund dal zrekonštruovať len oklikou: suma zo záporného riadku
-- v `payments`, čas z `tickets.refunded_at`, dôvod z `payment_logs.request_payload`
-- (čo je ladiaci log poskytovateľa platby, nie obchodný záznam) a pri pokladni
-- z `orders.void_reason`. Prehľad Storno tak nemal z čoho čítať a stránka
-- `/admin/sales/cancellations` ukazovala vymyslené riadky.
--
-- Dôležité pri čiastočných refundoch: objednávka zostáva `paid`, takže bez
-- súčtu vrátenej sumy sa dala vrátiť viackrát dokola. `refunded_amount` je
-- kumulatívne a server podľa neho počíta zostatok.

alter table public.orders
  add column if not exists refunded_at timestamptz,
  add column if not exists refunded_amount numeric(10,2) not null default 0,
  add column if not exists refund_reason text,
  add column if not exists refunded_by uuid references auth.users(id) on delete set null;

create index if not exists orders_refunded_at_idx on public.orders (refunded_at desc);

-- --- Doplnenie z toho, čo už v databáze je ---------------------------------

-- 1) Vrátená suma zo záporných riadkov v `payments` (webové refundy).
with sums as (
  select order_id, sum(abs(amount)) as refunded
  from public.payments
  where status = 'refunded' and amount < 0
  group by order_id
)
update public.orders o
set refunded_amount = sums.refunded
from sums
where sums.order_id = o.id and o.refunded_amount = 0;

-- 2) Storno z pokladne nemá riadok v `payments` — tam sa vracia celá suma.
update public.orders o
set refunded_amount = o.total_amount
where o.status = 'refunded' and o.refunded_amount = 0;

-- 3) Čas: posledný záporný pohyb, inak posledná refundovaná vstupenka.
update public.orders o
set refunded_at = coalesce(
  (select max(p.created_at) from public.payments p
    where p.order_id = o.id and p.status = 'refunded' and p.amount < 0),
  (select max(t.refunded_at) from public.tickets t where t.order_id = o.id),
  o.updated_at
)
where o.refunded_at is null and o.refunded_amount > 0;

-- 4) Dôvod: pokladňa ho má vo `void_reason`, web v ladiacom logu platby.
update public.orders o
set refund_reason = o.void_reason
where o.refund_reason is null and o.void_reason is not null;

update public.orders o
set refund_reason = l.reason,
    refunded_by = l.by_user
from (
  select distinct on (pl.order_id)
    pl.order_id,
    nullif(pl.request_payload ->> 'reason', '') as reason,
    (pl.request_payload ->> 'by')::uuid as by_user
  from public.payment_logs pl
  where pl.request_payload ? 'reason'
  order by pl.order_id, pl.created_at desc
) l
where l.order_id = o.id
  and o.refunded_amount > 0
  and o.refund_reason is null;
