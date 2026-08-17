-- Vygenerované doklady z pokladne (uzávierky, pokladničné doklady).
--
-- Uzávierka je účtovný dokument — musí sa dať stiahnuť aj o rok neskôr presne
-- v tom tvare, v akom vznikla. Preto sa PDF ukladá, nie generuje nanovo:
-- neskoršia zmena šablóny ani opravný predaj ním už nepohnú.
--
-- Obsah držíme ako base64 text, nie bytea — PostgREST bytea vracia v hex tvare
-- a klient by ho musel prekladať. Doklad má rádovo desiatky kB, takže to
-- Postgres v pohode zvládne (stĺpec sa aj tak TOAST-uje a komprimuje).

create table if not exists public.pos_documents (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('closing', 'receipt')),
  closing_id uuid references public.pos_closings(id) on delete cascade,
  order_id uuid references public.orders(id) on delete set null,
  -- Čitateľný názov do zoznamu, napr. „Uzávierka 17. 8. 2026 — Zuzka P."
  title text not null,
  filename text not null,
  content_type text not null default 'application/pdf',
  size_bytes integer not null,
  content_base64 text not null,
  created_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists pos_documents_organizer_idx
  on public.pos_documents (organizer_id, created_at desc);
create index if not exists pos_documents_closing_idx
  on public.pos_documents (closing_id);
create index if not exists pos_documents_order_idx
  on public.pos_documents (order_id);

-- Jedna uzávierka = jeden doklad. Opakované generovanie ho prepíše, nie zduplikuje.
create unique index if not exists pos_documents_closing_unique
  on public.pos_documents (closing_id) where closing_id is not null;

alter table public.pos_documents enable row level security;

drop policy if exists pos_documents_owner on public.pos_documents;
create policy pos_documents_owner on public.pos_documents
  for all to authenticated
  using (organizer_id = auth.uid() or has_role(auth.uid(), 'admin'::app_role))
  with check (organizer_id = auth.uid() or has_role(auth.uid(), 'admin'::app_role));
