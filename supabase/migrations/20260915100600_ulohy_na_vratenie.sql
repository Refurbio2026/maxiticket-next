-- Úlohy na vrátenie peňazí.
--
-- Doteraz bol refund iba stĺpcami na objednávke (`refunded_amount`,
-- `refund_reason`): vieme, že sa niečo vrátilo, ale nie že sa vrátiť *má*.
-- Párovanie výpisov potrebuje presne to druhé — záväzok, ktorý ešte nikto
-- nevybavil:
--
-- - prišlo viac, než mala objednávka stáť (preplatok nad limitom),
-- - platba dorazila na objednávku, ktorá je už zaplatená alebo zrušená,
-- - sedadlá medzitým kúpil niekto iný.
--
-- Tá istá tabuľka zachytáva aj požiadavku zo špecifikácie, aby storno
-- zaplatenej objednávky nikdy nezostalo bez rozhodnutia o peniazoch: buď
-- vznikne úloha, alebo sa zamietne s dôvodom (`rejected` + `reject_reason`).

create table if not exists public.refund_tasks (
  id uuid primary key default gen_random_uuid(),
  -- Preplatok od niekoho, koho objednávku sa nepodarilo určiť, objednávku
  -- mať nemusí. Peniaze treba vrátiť tak či tak.
  order_id uuid references public.orders (id) on delete set null,
  -- Prijatá platba, z ktorej úloha vznikla.
  transaction_id uuid references public.bank_transactions (id) on delete set null,
  amount numeric(14, 2) not null check (amount > 0),
  currency text not null default 'EUR',
  -- Kam poslať. Pri platbe z účtu je to protiúčet, inak ho treba vypýtať.
  iban text,
  holder_name text,
  reason text not null check (reason in (
    'overpaid', 'already_paid', 'seats_unavailable', 'reservation_cancelled',
    'chargeback', 'customer_request', 'event_cancelled'
  )),
  status text not null default 'requested' check (status in (
    'requested', 'approved', 'exported', 'sent', 'confirmed', 'rejected'
  )),
  -- Povinné pri zamietnutí: „nevraciame" musí byť rozhodnutie, nie ticho.
  reject_reason text,
  -- Odchádzajúca platba z výpisu, ktorá úlohu uzavrela.
  outgoing_transaction_id uuid references public.bank_transactions (id) on delete set null,
  export_batch_id uuid,
  note text,
  created_by uuid references auth.users (id) on delete set null,
  approved_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint refund_tasks_zamietnutie_ma_dovod check (
    status <> 'rejected' or (reject_reason is not null and length(btrim(reject_reason)) > 0)
  )
);

create index if not exists refund_tasks_status_idx on public.refund_tasks (status, created_at desc);
create index if not exists refund_tasks_order_idx on public.refund_tasks (order_id) where order_id is not null;
create index if not exists refund_tasks_tx_idx on public.refund_tasks (transaction_id) where transaction_id is not null;

-- Z jednej prijatej platby vznikne najviac jedna otvorená úloha. Bez toho by
-- opakovaný beh párovania založil úlohu na ten istý preplatok pri každom behu.
create unique index if not exists refund_tasks_jedna_na_transakciu
  on public.refund_tasks (transaction_id, reason)
  where transaction_id is not null and status <> 'rejected';

drop trigger if exists trg_refund_tasks_updated_at on public.refund_tasks;
create trigger trg_refund_tasks_updated_at
  before update on public.refund_tasks
  for each row execute function public.update_updated_at_column();

-- Väzba z rozhodnutia párovania na úlohu.
alter table public.transaction_matches
  add column if not exists refund_task_id uuid references public.refund_tasks (id) on delete set null;

alter table public.refund_tasks enable row level security;

drop policy if exists refund_tasks_admin on public.refund_tasks;
create policy refund_tasks_admin on public.refund_tasks
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

grant select, insert, update, delete on public.refund_tasks to authenticated;
