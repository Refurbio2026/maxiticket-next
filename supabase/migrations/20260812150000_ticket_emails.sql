-- Fáza 4: doručenie vstupenky e-mailom.
--
-- GoPay notifikáciu môže poslať viackrát a `settleOrderIfPaid` volá aj návratová
-- stránka, takže bez značky by zákazník dostal vstupenky opakovane. Pečiatka
-- `tickets_emailed_at` drží odoslanie idempotentné rovnako ako
-- `superfaktura_invoice_id` pri fakturácii.

alter table public.orders
  add column if not exists tickets_emailed_at timestamptz;

-- Log odoslaných e-mailov — na dohľadanie, prečo zákazníkovi vstupenka neprišla.
create table if not exists public.email_logs (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references public.orders(id) on delete cascade,
  recipient text not null,
  subject text not null,
  provider text not null default 'resend',
  provider_message_id text,
  status sf_log_status not null,
  error_message text,
  created_at timestamptz not null default now()
);

create index if not exists email_logs_order_idx on public.email_logs (order_id);

alter table public.email_logs enable row level security;

-- Log obsahuje e-mailové adresy zákazníkov — vidieť ho smie len admin.
-- Zapisuje sa výhradne cez service_role zo servera.
create policy email_logs_admin_select on public.email_logs
  for select to authenticated
  using (public.has_role(auth.uid(), 'admin'));

grant select on public.email_logs to authenticated;
grant all on public.email_logs to service_role;
