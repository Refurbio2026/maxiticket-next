-- Skenovanie vstupeniek starého systému našou čítačkou.
--
-- Dve obmedzenia určujú celý návrh:
--
-- 1. **Do OM sa nedá zapísať.** Sync tam má len `SELECT`, takže sken urobený
--    našou čítačkou zostane u nás a stará čítačka o ňom nebude vedieť. Ak by
--    sa na dverách používali obe, tá istá vstupenka prejde dvakrát — na
--    podujatí sa preto smie skenovať len jednou.
--
-- 2. **`om_tickets.scan` prepisuje každý beh syncu**, takže náš sken sa doň
--    uložiť nedá. Musí mať vlastnú tabuľku, inak by ho kanál A o minútu zmazal.
--
-- Vstupenka sa hľadá podľa čiarového kódu **v rámci podujatia**, nikdy globálne:
-- 849 kódov sa v OM opakuje vo viacerých predstaveniach. V rámci jedného plánu
-- je kód jedinečný, takže dvojica (plán, kód) vstupenku určí jednoznačne.

create table if not exists public.om_ticket_scans (
  id uuid primary key default gen_random_uuid(),
  id_seat bigint not null,
  id_plan bigint not null,
  barcode bigint,
  -- Naše podujatie, cez ktoré sa skenovalo — skener sa autorizuje jeho
  -- `scanner_token`, takže bez neho by sken nevznikol.
  event_id uuid references public.events (id) on delete set null,
  event_date_id uuid references public.event_dates (id) on delete set null,
  result text not null check (result in ('valid', 'duplicate', 'reentry', 'refunded', 'invalid')),
  scanned_at timestamptz not null default now(),
  scanned_by uuid references auth.users (id) on delete set null,
  scanner_name text,
  user_agent text
);

comment on table public.om_ticket_scans is
  'Skeny vstupeniek starého systému vykonané našou čítačkou. Do OM sa nezapisujú — '
  'starý systém o nich nevie.';

-- Prvé použitie je atomické: `valid` smie na jedno miesto vzniknúť len raz.
-- Druhý súbežný sken na tomto indexe spadne a endpoint ho vyhodnotí ako
-- `duplicate`. Je to ten istý vzor ako `used_at` pri našich vstupenkách —
-- kontrola a zápis v jednom príkaze, nie dva dotazy za sebou.
create unique index if not exists om_ticket_scans_prve_pouzitie
  on public.om_ticket_scans (id_seat) where result = 'valid';

create index if not exists om_ticket_scans_plan_idx
  on public.om_ticket_scans (id_plan, scanned_at desc);
create index if not exists om_ticket_scans_event_idx
  on public.om_ticket_scans (event_id, scanned_at desc);

-- --- Vyhľadanie a stav ----------------------------------------------------
-- Jedna funkcia, ktorá zo `scanner_token`-om overeného podujatia a čiarového
-- kódu vráti vstupenku aj so všetkým, čo treba na rozhodnutie. Rozhodovanie
-- samotné zostáva v endpointe, nech je pre obe vetvy (naše aj OM) na jednom
-- mieste a čitateľné.
--
-- `uz_skenovana_v_om` berie do úvahy **skutočnú históriu zo starého systému**,
-- nie len počítadlo: vstupenka mohla prejsť starou čítačkou pred prechodom
-- a nesmie tu prejsť druhýkrát. Stav sa počíta v poradí `scan_time`, takže
-- zrušený sken sa správne nepočíta ako použitie.

create or replace function public.om_najdi_vstupenku(p_event_id uuid, p_barcode bigint)
returns table (
  id_seat bigint,
  id_plan bigint,
  event_date_id uuid,
  category text,
  suspicious boolean,
  vanished_at timestamptz,
  seat_label text,
  price numeric,
  uz_skenovana_v_om boolean,
  skenovana_u_nas_at timestamptz,
  refundovana boolean
)
language sql
stable
security definer
set search_path = public
as $$
  select t.id_seat,
         t.id_plan,
         m.event_date_id,
         t.category::text,
         t.suspicious,
         t.vanished_at,
         -- OM nemá čitateľný popis miesta v `seat`; rad a číslo sú v
         -- `theater_seat`, ktoré nesynchronizujeme. Kým to nie je potrebné,
         -- vracia sa čiarový kód.
         t.barcode::text as seat_label,
         t.price,
         coalesce(sk.scan_type = 0, false) as uz_skenovana_v_om,
         (select max(s.scanned_at) from public.om_ticket_scans s
           where s.id_seat = t.id_seat and s.result = 'valid') as skenovana_u_nas_at,
         exists (
           select 1 from public.om_refunds r
            where r.id_seat_note = t.id_seat_note and r.date_refund is not null
         ) as refundovana
    from public.om_event_map m
    join public.om_tickets t on t.id_plan = m.id_plan
    left join public.om_posledny_sken sk
           on sk.id_plan = t.id_plan and sk.barcode = t.barcode
   where m.event_id = p_event_id
     -- Len potvrdená väzba. Návrh automatu nesmie otvoriť dvere.
     and m.status = 'confirmed'
     and t.barcode = p_barcode;
$$;

comment on function public.om_najdi_vstupenku(uuid, bigint) is
  'Vstupenka starého systému podľa podujatia a čiarového kódu. Hľadá výhradne '
  'v plánoch s potvrdenou väzbou — návrh automatického párovania dvere neotvorí.';

-- --- Prístup --------------------------------------------------------------

alter table public.om_ticket_scans enable row level security;
revoke all on table public.om_ticket_scans from anon, authenticated;
grant all on table public.om_ticket_scans to service_role;

revoke all on function public.om_najdi_vstupenku(uuid, bigint) from public, anon, authenticated;
grant execute on function public.om_najdi_vstupenku(uuid, bigint) to service_role;
