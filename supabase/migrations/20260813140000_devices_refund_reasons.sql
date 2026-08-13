-- Zariadenia (čítačky, terminály, tlačiarne) a číselník dôvodov refundácie.
--
-- Obidve tabuľky sú číselníky, ktoré doteraz existovali len ako vymyslené
-- riadky v `admin-mock.ts`.
--
-- Zariadenia: `ticket_scans.scanner_name` bol voľný text zadaný v prehliadači,
-- takže sa nedalo spoľahlivo povedať, ktorá čítačka pri ktorých dverách stála.
-- Teraz má zariadenie svoj riadok a skener si ho vyberá zo zoznamu.
--
-- Dôvody refundácie: `refundOrder` prijímal voľný text, z ktorého sa nedala
-- urobiť štatistika („zrušené podujatie" vs. „zrusene" vs. prázdne).

create table if not exists public.scanner_devices (
  id uuid primary key default gen_random_uuid(),
  organizer_id uuid not null references auth.users (id) on delete cascade,
  name text not null,
  device_type text not null default 'scanner'
    check (device_type in ('scanner', 'terminal', 'printer', 'kiosk')),
  -- Sériové číslo alebo iné označenie na zariadení, aby sa dalo fyzicky nájsť.
  serial_number text,
  location text,
  -- Voliteľná väzba na podujatie; NULL = zariadenie sa používa všade.
  event_id uuid references public.events (id) on delete set null,
  status text not null default 'active' check (status in ('active', 'inactive')),
  note text,
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists scanner_devices_organizer_idx on public.scanner_devices (organizer_id);
create index if not exists scanner_devices_event_idx on public.scanner_devices (event_id);

drop trigger if exists trg_scanner_devices_updated_at on public.scanner_devices;
create trigger trg_scanner_devices_updated_at
  before update on public.scanner_devices
  for each row execute function public.update_updated_at_column();

-- Skener beží na tablete pri dverách a autorizuje sa tokenom podujatia, nie
-- prihlásením. Zapísať čas posledného použitia preto musí funkcia so
-- `security definer` — inak by tablet potreboval prihláseného používateľa.
create or replace function public.touch_scanner_device(p_device_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.scanner_devices set last_seen_at = now() where id = p_device_id;
$$;

revoke execute on function public.touch_scanner_device(uuid) from anon, authenticated, public;

alter table public.scanner_devices enable row level security;

drop policy if exists scanner_devices_owner_all on public.scanner_devices;
create policy scanner_devices_owner_all on public.scanner_devices
  for all to authenticated
  using (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role))
  with check (organizer_id = auth.uid() or public.has_role(auth.uid(), 'admin'::app_role));

grant select, insert, update, delete on public.scanner_devices to authenticated;

-- --- Dôvody refundácie -------------------------------------------------

create table if not exists public.refund_reasons (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  name text not null,
  description text,
  -- Dôvod, pri ktorom musí obsluha dopísať vysvetlenie (napr. „iné").
  requires_note boolean not null default false,
  -- Ide refundácia na vrub organizátora? Rozhoduje o tom, či sa provízia vracia.
  organizer_fault boolean not null default false,
  active boolean not null default true,
  sort_order integer not null default 100,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

drop trigger if exists trg_refund_reasons_updated_at on public.refund_reasons;
create trigger trg_refund_reasons_updated_at
  before update on public.refund_reasons
  for each row execute function public.update_updated_at_column();

-- Základná sada, aby číselník nebol pri prvom otvorení prázdny.
insert into public.refund_reasons (code, name, description, requires_note, organizer_fault, sort_order)
values
  ('event_cancelled', 'Zrušené podujatie', 'Organizátor podujatie zrušil.', false, true, 10),
  ('event_moved', 'Presunutý termín', 'Zákazník nesúhlasí s novým termínom.', false, true, 20),
  ('customer_request', 'Žiadosť zákazníka', 'Zákazník požiadal o vrátenie peňazí.', false, false, 30),
  ('duplicate_order', 'Dvojitá objednávka', 'Zákazník zaplatil to isté dvakrát.', false, false, 40),
  ('payment_error', 'Chyba platby', 'Technický problém pri platbe.', false, false, 50),
  ('other', 'Iné', 'Dôvod treba dopísať ručne.', true, false, 900)
on conflict (code) do nothing;

alter table public.refund_reasons enable row level security;

-- Číselník číta ktokoľvek prihlásený (potrebuje ho refundačný dialóg
-- organizátora), meniť ho smie len admin.
drop policy if exists refund_reasons_read on public.refund_reasons;
create policy refund_reasons_read on public.refund_reasons
  for select to authenticated using (true);

drop policy if exists refund_reasons_admin_write on public.refund_reasons;
create policy refund_reasons_admin_write on public.refund_reasons
  for all to authenticated
  using (public.has_role(auth.uid(), 'admin'::app_role))
  with check (public.has_role(auth.uid(), 'admin'::app_role));

grant select, insert, update, delete on public.refund_reasons to authenticated;
