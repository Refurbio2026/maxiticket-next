# CLAUDE.md

Ticketingová platforma **MaxiTicket / vipky.sk** — predaj vstupeniek, rezervácia sedadiel,
GoPay platby, SuperFaktúra, QR vstupenky, skener na vstupe, POS pokladne, wallet passy.

## Príkazy

```bash
bun install          # bun je package manager (bun.lock, bunfig.toml)
bun run dev          # vite dev
bun run build        # vite build (Nitro SSR)
bun run lint         # eslint
bun run format       # prettier --write .
npx tsc --noEmit     # typecheck (nie je npm skript)
```

## Stack

TanStack Start (SSR cez Nitro) · React 19 · Vite 7 · Tailwind 4 · shadcn/ui + Radix ·
Supabase (auth + Postgres) · TanStack Query · Zod · konva (editor sál) · jspdf + qrcode.react.

Vite konfig ide cez `@lovable.dev/vite-tanstack-config` — **nepridávaj** tanstackStart, viteReact,
tailwindcss, tsConfigPaths ani nitro ručne, sú už vnútri a duplikát appku rozbije.

## DÔLEŽITÉ: dve dátové vrstvy vedľa seba

Projekt má **dva nezávislé zdroje dát** a treba vedieť, v ktorom sa práve nachádzaš.

**1. Supabase (reálne, produkčné)** — 12 tabuliek s RLS:
`profiles`, `user_roles`, `events`, `ticket_types`, `orders`, `order_items`, `seat_inventory`,
`tickets`, `payments`, `payment_logs`, `superfaktura_logs`, `ticket_scans`.
Používa ju: auth (`use-auth.tsx`), platobný tok (`payments.functions.ts`), refundácie,
skenovanie (`api.public.tickets.scan.ts`), admin štatistiky, „moje vstupenky".

**2. localStorage „databáza" (demo)** — `src/lib/local-db.ts` + `pos-db.ts`, `bank-db.ts`,
`cashier-db.ts`, `marketing-db.ts`, `wallet-db.ts`, `ticketing-db.ts`, `admin-mock.ts`.
Zostáva na nej POS, marketing, banka, protokoly, kategórie a obsadenosť sedadiel.

**Rozloženia sál sú v databáze** (`venue_layouts`). Čítaj ich cez `@/hooks/use-layouts`
(`useLayouts`, `useLayout`, `useUpsertLayout`, `useDeleteLayout`, `toLayoutInput`), typy a čisté
pomocníky sú v `lib/layout-types.ts` (bez localStorage, importuje ich aj server).
Tvary a oblúkové skupiny sú JSONB — sú to voľné štruktúry editora, nedotazujeme sa do nich.

**29 admin stránok nad `admin-mock.ts` je fikcia.** V `AdminSidebar` sú označené `demo: true`
a predvolene skryté (prepínač v pätičke), `DataTablePage` na nich zobrazuje varovný banner.
Keď niektorú napojíš na databázu, zmaž jej `demo: true`.

**Katalóg podujatí je od fázy 2 v databáze.** Čítaj a zapisuj ho **výhradne** cez
`@/hooks/use-events` — `useEvents({ scope })`, `useEvent(id)`, `useUpsertEvent()`,
`useDeleteEvent()`, `toEventInput()`. Tie volajú server funkcie v `@/lib/events.functions`.
Funkcie `getEvents/getEvent/upsertEvent/deleteEvent` v `local-db.ts` sú označené `@deprecated`
a nikto ich nepoužíva; podujatie zapísané cez ne sa v katalógu nezobrazí a checkout ho neuvidí.

Vlastníctvo sa vynucuje na serveri: `organizer_id` sa neberie z klienta (odvodí sa z prihlásenia),
výnimkou je admin, ktorý smie poslať `organizer_id` a založiť podujatie za organizátora.

Nové perzistentné dáta píš do Supabase, nie do localStorage.

### Anonymné dotazy na `events` musia vymenovať stĺpce

`anon` nemá tabuľkový `select` na `events` — má len stĺpcový grant, ktorý **zámerne vynecháva
`scanner_token`** (migrácia `20260727120000`). Preto `supabase.from("events").select("*")` z
odhláseného prehliadača spadne na `42501 permission denied for table events`. Vždy vymenuj
stĺpce. Prihlásení používatelia majú plný grant, takže `*` im prejde — chyba sa prejaví len
u nenalogovaného návštevníka.

## Routing

File-based v `src/routes/`, **flat s bodkami**: `admin.events.venues.tsx` → `/admin/events/venues`.
Dynamické `$id`, layout `admin.tsx` renderuje `<Outlet />`, shell je `__root.tsx`.
`routeTree.gen.ts` je generovaný — needituj ho ručne. Viac v `src/routes/README.md`.

Nepoužívaj Next.js/Remix konvencie (`src/pages/`, `app/layout.tsx`).

Zóny: verejný web (`index`, `events*`, `checkout*`, `scanner`, `support`, `account`),
`organizer.*`, `admin.*`, a API endpointy `api.public.*.ts` (server handlers).

## Server / klient hranica

- `*.server.ts` = server-only, nikdy neimportuj z klientskeho kódu (drží API kľúče mimo bundle):
  `gopay.server.ts`, `superfaktura.server.ts`, `google-wallet.server.ts`, `qr-token.server.ts`,
  `order-access.server.ts`, `support-bot.server.ts`, `client.server.ts`, `config.server.ts`.
- `*.functions.ts` = `createServerFn` deklarácie. Drž ich tenké — logika patrí do `.server.ts`.
- Každá privilegovaná server funkcia má `.middleware([requireSupabaseAuth])` a rolu si overuje
  sama cez `assertAdmin(context.userId)`. Nový endpoint rob rovnako.
- `supabaseAdmin` (`client.server.ts`) obchádza RLS — len server, nikdy klient.
- Vstupy validuj Zodom v `.inputValidator()`.

## Bezpečnostné vzory, ktoré treba dodržať

- **QR vstupenky** — HMAC podpísané, formát `MT2.<uuid-bez-pomlčiek>.<hmac8>` (`qr-token.server.ts`).
  Nikdy negeneruj plaintext QR ani nepridávaj fallback secret.
- **Skenovanie** — autorizuje sa výhradne cez `event.scanner_token`, nikdy cez `event_id` z tela
  requestu, inak by hocikto mohol označovať lístky ako použité.
- **Order PII** — `getOrderSummary` vracia meno/email/telefón len s platným HMAC access tokenom
  (`order-access.server.ts`); bez neho sa PII strippuje.
- **GoPay webhook** — telu notifikácie sa never; stav sa vždy doťahuje z GoPay API server-side.
- **Ceny** — `submitOrder` neprijíma od klienta cenu, len `ticket_type_id` / `seat_id` a počet.
  Sumu odvodí server z `ticket_types.price`, prípadne z `events.base_price` / `vip_price`.
  Či je sedadlo VIP, si server zisťuje z `venue_layouts.shapes` (`seat_id` má tvar
  `<id tvaru>::r<riadok>c<stĺpec>`) — príznak `is_vip` od klienta sa **ignoruje**.
  Nikdy neprevezmi cenu ani VIP príznak z requestu.
- **Sedadlá** — rezervuje ich výhradne Postgres funkcia `reserve_seats()`, kde je kontrola aj
  zápis jeden atómický príkaz. Nikdy nerob slepý upsert do `seat_inventory` ani nedeľ kontrolu
  a zápis na dva dotazy — medzi ne sa zmestí súbežný kupujúci.
- **Kapacita** — položky bez sedadla sa porovnávajú s `ticket_types.quantity`, resp.
  `events.total_tickets`; kapacita 0 znamená „neobmedzené".
- **Limity** — verejné endpointy, ktoré niečo stoja alebo blokujú, idú cez
  `hit_rate_limit()` (pevné okno, atomický inkrement). `submitOrder`: 20/h na IP, 10/h na e-mail,
  max 20 vstupeniek a 2 nedoplatené objednávky naraz. `askSupport`: 30/h na IP.
  IP ber z `X-Real-IP` — nginx ho prepisuje, takže sa nedá podvrhnúť; prvá položka
  `X-Forwarded-For` pochádza od klienta.
- **Refundované vstupenky** — označ `tickets.refunded_at`, nie `used_at`. Skener má vlastný
  výsledok `refunded`; zneužitie `used_at` klamalo personál aj štatistiky.
- **Wallet passy** — `getGoogleWalletSaveLink` prijíma iba QR kód; názov podujatia, sedadlo aj
  meno držiteľa si doťahuje z databázy. Nikdy nepodpisuj obsah passu z klientskych údajov.
- **`/api/public/seed-demo`** — vytvára reálne admin účty; inertný bez `SEED_SECRET`.
- **Vstupenky podujatia** — `getEventSoldTickets` vracia QR payloady; samotné prihlásenie
  nestačí (RLS pustí k publikovanému podujatiu každého). Vyžaduj admina alebo vlastníka.

## E-mail so vstupenkami

Po prechode objednávky do stavu `paid` sa zákazníkovi pošlú vstupenky s PDF v prílohe.
Volá sa to z oboch ciest vysporiadania — GoPay webhook aj overenie pri návrate z brány.

- `mailer.server.ts` — Resend cez HTTP, bez `RESEND_API_KEY` nečinný (ako support bot).
- `ticket-mail.server.ts` — zloží e-mail, priloží PDF, zapíše do `email_logs`.
- `ticket-pdf.server.ts` — PDF v Node. **Pozor:** `import { jsPDF } from "jspdf"` musí byť
  pomenovaný, default export v Node ESM nie je konštruktor.
- Idempotencia cez `orders.tickets_emailed_at` — opakovaná notifikácia z GoPay nepošle
  vstupenky druhýkrát. Admin má `resendTicketsEmail` s `force`.
- Zlyhanie odoslania **nikdy** nezhodí vysporiadanie platby ani webhook.

## PDF vstupeniek

**Vzniká výhradne na serveri** (`ticket-pdf.server.ts`), klient si ho pýta cez
`ticket-pdf.functions.ts` a dostane base64, ktorý uloží pomocou `downloadBase64()`.
Jeden generátor pre e-mail aj stiahnutie — a jspdf, canvg ani html2canvas sa neposielajú
do prehliadača (klientsky bundle je vďaka tomu o ~800 kB menší). **Negeneruj PDF v komponente.**

Autorizácia: `renderOrderTicketsPdf` vyžaduje podpísaný order access token (PDF obsahuje QR
kódy), `renderEventTicketsPdf` admina alebo vlastníka podujatia.

**Diakritika:** vstavané fonty jsPDF vedia len Latin-1 a znaky mimo nej (č, š, ž, ť, ď, ľ, ň)
bez varovania zahodia — „Štúdio" sa tlačilo ako „túdio". Preto je vložený DejaVu Sans
(`fonts/dejavu-sans.ts`, generovaný, needituj ho). jsPDF ho pri zápise subsetuje, hotové PDF
má ~165 kB. Text neprepisuj ani nesanituj — font pokrýva celú slovenčinu.

## Roly

Enum `app_role`: `user | organizer | admin`. Rola sa číta z `user_roles`, nie z JWT metadát.
Registrácia dá vždy `user`; organizer/admin prideľuje admin (vynútené RLS) — self-assignment
je zámerne nemožný.

## i18n

Vlastné riešenie bez knižnice: `src/lib/i18n.ts` + generované `i18n.generated.ts` (116 kB).
Jazyky SK (default) / EN / DE / HU. Ploché kľúče `nav.events`, interpolácia `{{name}}`.
**Nový kľúč pridaj do všetkých štyroch jazykov.** Chýbajúci kľúč padá na SK, potom na raw kľúč.
V komponentoch cez `useI18n()`.

## Env premenné

V `.env` sú len `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PROJECT_ID` (+ `VITE_` varianty).
Server kód navyše potrebuje (inak hodí runtime error):

| Premenná                                                 | Načo                                                                         |
| -------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `SUPABASE_SERVICE_ROLE_KEY`                              | **povinné** — `supabaseAdmin`, celý serverový tok                            |
| `TICKET_QR_SECRET`                                       | podpis QR vstupeniek a order access tokenov (fallback: service role key)     |
| `GOPAY_CLIENT_ID` / `GOPAY_CLIENT_SECRET` / `GOPAY_GOID` | platby (`GOPAY_API_URL` default sandbox)                                     |
| `SUPERFAKTURA_EMAIL` / `_API_KEY` / `_COMPANY_ID`        | fakturácia                                                                   |
| `PUBLIC_SITE_URL`                                        | return/notification URL pre GoPay (inak hardcoded lovable doména)            |
| `GOOGLE_WALLET_*`                                        | wallet passy, viď `WALLET_SETUP.md`                                          |
| `OPENAI_API_KEY`                                         | AI support chat (bez neho vracia „nie je aktivovaná")                        |
| `RESEND_API_KEY`                                         | odosielanie vstupeniek e-mailom (bez neho sa ticho preskočí)                 |
| `MAIL_FROM` / `MAIL_REPLY_TO`                            | odosielateľ, default `vipky.sk <listky@vipky.sk>` (doména overená v Resende) |
| `SEED_SECRET`                                            | odomkne `/api/public/seed-demo`                                              |

## Pripojenie k databáze (správa schémy)

Projekt `aasraovckzekicoobadx`. Priame spojenie `db.<ref>.supabase.co` beží len cez IPv6, ktoré
tento server nemá — choď cez pooler:

```
host  aws-1-eu-west-1.pooler.supabase.com
port  5432
user  postgres.aasraovckzekicoobadx
heslo SUPABASE_DB_PASSWORD z /opt/maxiticket/.env
```

Klient PostgreSQL 18 je rozbalený v `/opt/maxiticket/restore/pg18/root/` (nie je nainštalovaný
v systéme). Volaj ho s `LD_LIBRARY_PATH=/opt/maxiticket/restore/pg18/root/usr/lib/x86_64-linux-gnu`.

Migrácie sú nasadené a zapísané v `supabase_migrations.schema_migrations`, takže ďalšie zmeny
schémy rob novou migráciou v `supabase/migrations/`, nie ručným SQL.

Funkcie v databáze: `has_role()`, `handle_new_user()`, `update_updated_at_column()`,
`reserve_seats()` (atómická rezervácia) a `expire_stale_orders()`. Posledná menovaná beží
každých 5 minút cez `pg_cron` (úloha `expire-stale-orders`) a navyše ju oportunisticky volá
`submitOrder`. Zoznam úloh: `select * from cron.job;`

## Konvencie kódu

- Prettier + ESLint; UI komponenty shadcn v `src/components/ui` (needituj ich zbytočne).
- Cesty cez alias `@/`.
- Používateľské texty sú po slovensky (aj chybové hlášky zo server funkcií).
- Komentáre v kóde sú miešané SK/EN — drž sa štýlu okolitého súboru.
- `toast` zo `sonner` na notifikácie.
