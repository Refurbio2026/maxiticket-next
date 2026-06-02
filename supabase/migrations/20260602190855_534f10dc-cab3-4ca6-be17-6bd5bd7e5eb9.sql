-- =========================================================================
-- Enums
-- =========================================================================
create type public.order_status as enum (
  'pending',
  'awaiting_payment',
  'paid',
  'failed',
  'cancelled',
  'refunded',
  'expired'
);

create type public.payment_provider as enum ('gopay');

create type public.payment_status as enum (
  'pending',
  'authorized',
  'paid',
  'failed',
  'cancelled',
  'refunded'
);

create type public.seat_status as enum ('available', 'reserved', 'sold');

create type public.sf_log_status as enum ('ok', 'error');

-- =========================================================================
-- orders
-- =========================================================================
create table public.orders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid,
  event_id uuid not null references public.events(id) on delete restrict,
  customer_name text,
  customer_email text,
  customer_phone text,
  total_amount numeric(12,2) not null default 0,
  currency text not null default 'EUR',
  status public.order_status not null default 'pending',
  gopay_payment_id text,
  gopay_payment_url text,
  superfaktura_invoice_id text,
  superfaktura_invoice_number text,
  superfaktura_invoice_pdf_url text,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  paid_at timestamptz
);

create index orders_user_id_idx on public.orders(user_id);
create index orders_event_id_idx on public.orders(event_id);
create index orders_status_idx on public.orders(status);
create index orders_gopay_payment_id_idx on public.orders(gopay_payment_id);

grant select on public.orders to authenticated;
grant all on public.orders to service_role;

alter table public.orders enable row level security;

create policy "orders_owner_select"
  on public.orders for select
  to authenticated
  using (
    user_id = auth.uid()
    or has_role(auth.uid(), 'admin'::app_role)
    or exists (
      select 1 from public.events e
      where e.id = orders.event_id and e.organizer_id = auth.uid()
    )
  );

-- =========================================================================
-- order_items
-- =========================================================================
create table public.order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  ticket_type_id uuid references public.ticket_types(id) on delete set null,
  seat_id text,
  label text not null,
  unit_price numeric(12,2) not null default 0,
  quantity integer not null default 1,
  created_at timestamptz not null default now()
);

create index order_items_order_id_idx on public.order_items(order_id);

grant select on public.order_items to authenticated;
grant all on public.order_items to service_role;

alter table public.order_items enable row level security;

create policy "order_items_owner_select"
  on public.order_items for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = order_items.order_id
        and (
          o.user_id = auth.uid()
          or has_role(auth.uid(), 'admin'::app_role)
          or exists (
            select 1 from public.events e
            where e.id = o.event_id and e.organizer_id = auth.uid()
          )
        )
    )
  );

-- =========================================================================
-- seat_inventory  (verejne čitateľný stav obsadenosti)
-- =========================================================================
create table public.seat_inventory (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events(id) on delete cascade,
  seat_id text not null,
  status public.seat_status not null default 'available',
  price numeric(12,2) not null default 0,
  label text,
  is_vip boolean not null default false,
  order_id uuid references public.orders(id) on delete set null,
  reserved_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (event_id, seat_id)
);

create index seat_inventory_event_id_idx on public.seat_inventory(event_id);
create index seat_inventory_status_idx on public.seat_inventory(status);

grant select on public.seat_inventory to anon, authenticated;
grant all on public.seat_inventory to service_role;

alter table public.seat_inventory enable row level security;

create policy "seat_inventory_public_select"
  on public.seat_inventory for select
  to anon, authenticated
  using (true);

-- =========================================================================
-- tickets  (vydaná vstupenka s QR)
-- =========================================================================
create table public.tickets (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  event_id uuid not null references public.events(id) on delete restrict,
  seat_id text,
  seat_label text not null,
  qr_code text not null unique,
  issued_at timestamptz not null default now(),
  used_at timestamptz
);

create index tickets_order_id_idx on public.tickets(order_id);
create index tickets_event_id_idx on public.tickets(event_id);

grant select on public.tickets to authenticated;
grant all on public.tickets to service_role;

alter table public.tickets enable row level security;

create policy "tickets_owner_select"
  on public.tickets for select
  to authenticated
  using (
    exists (
      select 1 from public.orders o
      where o.id = tickets.order_id
        and (
          o.user_id = auth.uid()
          or has_role(auth.uid(), 'admin'::app_role)
          or exists (
            select 1 from public.events e
            where e.id = o.event_id and e.organizer_id = auth.uid()
          )
        )
    )
  );

-- =========================================================================
-- payments
-- =========================================================================
create table public.payments (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references public.orders(id) on delete cascade,
  provider public.payment_provider not null default 'gopay',
  provider_payment_id text,
  amount numeric(12,2) not null,
  currency text not null default 'EUR',
  status public.payment_status not null default 'pending',
  raw_response jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index payments_order_id_idx on public.payments(order_id);
create index payments_provider_payment_id_idx on public.payments(provider_payment_id);
create index payments_status_idx on public.payments(status);

grant select on public.payments to authenticated;
grant all on public.payments to service_role;

alter table public.payments enable row level security;

create policy "payments_admin_select"
  on public.payments for select
  to authenticated
  using (
    has_role(auth.uid(), 'admin'::app_role)
    or exists (
      select 1 from public.orders o
      where o.id = payments.order_id
        and (
          o.user_id = auth.uid()
          or exists (
            select 1 from public.events e
            where e.id = o.event_id and e.organizer_id = auth.uid()
          )
        )
    )
  );

-- =========================================================================
-- payment_logs (audit)
-- =========================================================================
create table public.payment_logs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  provider public.payment_provider not null default 'gopay',
  endpoint text,
  request_payload jsonb,
  response_payload jsonb,
  status text,
  error_message text,
  created_at timestamptz not null default now()
);

create index payment_logs_order_id_idx on public.payment_logs(order_id);

grant select on public.payment_logs to authenticated;
grant all on public.payment_logs to service_role;

alter table public.payment_logs enable row level security;

create policy "payment_logs_admin_select"
  on public.payment_logs for select
  to authenticated
  using (has_role(auth.uid(), 'admin'::app_role));

-- =========================================================================
-- superfaktura_logs (audit)
-- =========================================================================
create table public.superfaktura_logs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete set null,
  invoice_id text,
  endpoint text,
  request_payload jsonb,
  response_payload jsonb,
  status public.sf_log_status not null default 'ok',
  error_message text,
  created_at timestamptz not null default now()
);

create index superfaktura_logs_order_id_idx on public.superfaktura_logs(order_id);

grant select on public.superfaktura_logs to authenticated;
grant all on public.superfaktura_logs to service_role;

alter table public.superfaktura_logs enable row level security;

create policy "superfaktura_logs_admin_select"
  on public.superfaktura_logs for select
  to authenticated
  using (has_role(auth.uid(), 'admin'::app_role));

-- =========================================================================
-- updated_at triggers (reuse existing public.update_updated_at_column)
-- =========================================================================
create or replace function public.update_updated_at_column()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create trigger trg_orders_updated_at
  before update on public.orders
  for each row execute function public.update_updated_at_column();

create trigger trg_seat_inventory_updated_at
  before update on public.seat_inventory
  for each row execute function public.update_updated_at_column();

create trigger trg_payments_updated_at
  before update on public.payments
  for each row execute function public.update_updated_at_column();
