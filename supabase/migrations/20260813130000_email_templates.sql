-- Emailové šablóny.
--
-- Text e-mailu so vstupenkami bol doteraz zadrôtovaný v `ticket-mail.server.ts`,
-- takže zmena jednej vety znamenala zásah do kódu a nový build. Teraz je
-- šablóna riadok v databáze; keď chýba alebo je vypnutá, použije sa vstavaná
-- verzia z kódu. Odosielanie tak nikdy nezávisí od toho, či šablóna existuje.

create table if not exists public.email_templates (
  -- Kľúč hovorí, KEDY sa šablóna použije. Nové kľúče pridávaj s kódom, ktorý
  -- ich vie odoslať — samotný riadok v tabuľke e-mail nespustí.
  key text primary key,
  name text not null,
  subject text not null,
  html text not null,
  -- Čistý text pre klientov, ktorí HTML nezobrazia. Prázdny = odvodí sa z kódu.
  text_body text,
  enabled boolean not null default true,
  updated_by uuid references auth.users (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_email_templates_updated_at on public.email_templates;
create trigger trg_email_templates_updated_at
  before update on public.email_templates
  for each row execute function public.update_updated_at_column();

-- --- Prístupové práva ---------------------------------------------------
-- Šablóny sú súčasť nastavenia platformy — mení ich len admin. Odosielanie
-- ide cez service role, ktorá RLS obchádza.

alter table public.email_templates enable row level security;

drop policy if exists email_templates_admin_all on public.email_templates;
create policy email_templates_admin_all on public.email_templates
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

grant select, insert, update, delete on public.email_templates to authenticated;
