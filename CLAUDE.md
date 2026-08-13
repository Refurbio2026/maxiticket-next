# CLAUDE.md

Ticketingová platforma **MaxiTicket / vipky.sk** — predaj vstupeniek, rezervácia sedadiel,
GoPay platby, SuperFaktúra, QR vstupenky, skener na vstupe, POS pokladne, wallet passy.

## Príkazy

```bash
bun install          # bun je package manager (bun.lock, bunfig.toml)
bun run dev          # vite dev
bun run lint         # eslint
bun run format       # prettier --write .
npx tsc --noEmit     # typecheck (nie je npm skript)

# BUILD VŽDY S PRESETOM, inak zhodíš beh na tomto serveri:
NITRO_PRESET=node-server bun run build
npx pm2 restart maxiticket --update-env
```

`NITRO_PRESET` je v `/opt/maxiticket/.env`, ktorý číta až pm2 pri spustení — build ho nevidí
a bez neho spadne na predvolený `cloudflare-module`. Taký `.output/server/index.mjs` sa síce
naštartuje, ale **na žiadnom porte nepočúva**, takže web je mŕtvy bez jedinej chyby v logu.
Po builde skontroluj `grep preset .output/nitro.json`.

## Stack

TanStack Start (SSR cez Nitro) · React 19 · Vite 7 · Tailwind 4 · shadcn/ui + Radix ·
Supabase (auth + Postgres) · TanStack Query · Zod · konva (editor sál) · jspdf + qrcode.react.

Vite konfig ide cez `@lovable.dev/vite-tanstack-config` — **nepridávaj** tanstackStart, viteReact,
tailwindcss, tsConfigPaths ani nitro ručne, sú už vnútri a duplikát appku rozbije.

## DÔLEŽITÉ: dve dátové vrstvy vedľa seba

Projekt má **dva nezávislé zdroje dát** a treba vedieť, v ktorom sa práve nachádzaš.

**1. Supabase (reálne, produkčné)** — 31 tabuliek s RLS:
`profiles`, `user_roles`, `events`, `event_dates`, `ticket_types`, `orders`, `order_items`,
`seat_inventory`, `tickets`, `payments`, `payment_logs`, `superfaktura_logs`, `ticket_scans`,
`venue_layouts`, `email_logs`, `rate_limits`, `settlements`, `platform_settings`, `venues`,
`pos_cashiers`, `pos_sessions`, `pos_closings`, `pos_receipt_counters`, `coupons`,
`coupon_redemptions`, `email_templates`, `scanner_devices`, `refund_reasons`,
`event_categories`, `performers`, `event_performers`.
Používa ju: auth (`use-auth.tsx`), platobný tok (`payments.functions.ts`), refundácie,
skenovanie (`api.public.tickets.scan.ts`), admin štatistiky, „moje vstupenky".

**2. localStorage „databáza" (demo)** — `src/lib/local-db.ts` + `pos-db.ts`, `bank-db.ts`,
`cashier-db.ts`, `marketing-db.ts`, `wallet-db.ts`, `ticketing-db.ts`, `admin-mock.ts`.
Zostáva na nej marketing, banka, účtovné reporty, wallet nastavenia a z POS
už len eKasa a stav terminálu (`payment-terminal-adapter.ts`, `fiscal-adapter.ts` — simulácia
hardvéru). Evidencia zariadení je od 13. 8. v databáze (`scanner_devices`).
`ticketing-db.ts` je už len košík (výber sedadiel v tomto prehliadači do kliknutia na „Zaplatiť");
skutočná obsadenosť je v `seat_inventory`.

**Rozloženia sál sú v databáze** (`venue_layouts`). Čítaj ich cez `@/hooks/use-layouts`
(`useLayouts`, `useLayout`, `useUpsertLayout`, `useDeleteLayout`, `toLayoutInput`), typy a čisté
pomocníky sú v `lib/layout-types.ts` (bez localStorage, importuje ich aj server).
Tvary a oblúkové skupiny sú JSONB — sú to voľné štruktúry editora, nedotazujeme sa do nich.

**18 admin stránok nad `admin-mock.ts` je fikcia.** V `AdminSidebar` sú označené `demo: true`,
`DataTablePage` na nich zobrazuje varovný banner. **Nič sa neskrýva** — stav je vidieť na bodke
za názvom: plná zelená = beží na databáze, dutá oranžová (`local: true`) = ukladá len do
localStorage, žiadna bodka = demo. Keď stránku napojíš na databázu, zmaž jej `demo: true`
(alebo `local: true`) a uprav počty v legende netreba — počítajú sa samy.

**Katalóg podujatí je od fázy 2 v databáze.** Čítaj a zapisuj ho **výhradne** cez
`@/hooks/use-events` — `useEvents({ scope })`, `useEvent(id)`, `useUpsertEvent()`,
`useDeleteEvent()`, `toEventInput()`. Tie volajú server funkcie v `@/lib/events.functions`.
Funkcie `getEvents/getEvent/upsertEvent/deleteEvent` v `local-db.ts` sú označené `@deprecated`
a nikto ich nepoužíva; podujatie zapísané cez ne sa v katalógu nezobrazí a checkout ho neuvidí.

Vlastníctvo sa vynucuje na serveri: `organizer_id` sa neberie z klienta (odvodí sa z prihlásenia),
výnimkou je admin, ktorý smie poslať `organizer_id` a založiť podujatie za organizátora.

Nové perzistentné dáta píš do Supabase, nie do localStorage.

### Používatelia a role
`users.functions.ts` + `/admin/system/users`. Rolu prideľuje výhradne admin (`setUserRole`),
`createUserWithRole` založí účet aj s rolou a potvrdeným e-mailom. Vlastnú `admin` rolu si
odobrať nedá — inak by sa dalo zamknúť sa z konzoly. Zápis do `user_roles` nerob nikde inde.

### Miesta konania
`venues.functions.ts` + `/admin/events/venues`. `events.venue_id` je väzba na číselník, ale
textové `events.venue` / `city` / `address` **zostávajú vyplnené** — číta ich verejný katalóg,
PDF aj e-maily a podujatie musí prežiť zmazanie miesta. `upsertEvent` ich pri uložení kopíruje
z miesta, premenovanie miesta ich prepíše vo všetkých jeho podujatiach. Miesto si nesie
`default_layout_id`, ktoré sa v admin formulári predvyplní aj s `sale_type = seating_map`.

### Kategórie podujatí

`event_categories` + `event-categories.functions.ts` + `/admin/data/categories`. Predtým žili
na troch nezosúladených miestach: localStorage v admin stránke, natvrdo zapísaný zoznam
v `admin.events.events.tsx` a voľný text v `events.category`.

`events.category` **ostáva textom** — číta ho verejný katalóg aj filtre a podujatie musí prežiť
zmazanie kategórie. Číselník je zdroj pravdy pre ponuku vo formulári; **premenovanie sa prepíše
do podujatí** (`upsertEventCategory`), inak by ich filter zaradil pod názov, ktorý neexistuje.
Kategóriu, ktorú niektoré podujatie používa, `deleteEventCategory` nezmaže — deaktivuje ju
(`active = false`), takže z ponuky zmizne, ale dá sa vrátiť. Formulár podujatia navyše doplní
do ponuky aktuálnu hodnotu podujatia, aj keď je kategória zrušená — bez toho by uloženie ticho
prepísalo kategóriu na inú.

### Účinkujúci

`performers` + `event_performers` + `performers.functions.ts` + `/admin/data/performers`.
Väzba na podujatie je M:N — na festivale hrá viac umelcov, jeden umelec vystupuje na viacerých
podujatiach. Zostava sa priraďuje z karty účinkujúceho (`upsertPerformer` s `event_ids` prepíše
celú väzbu naraz), vypisuje ju verejná `/artists` aj detail podujatia.

Žáner je **voľný text, nie číselník** — filtre na `/artists` sa skladajú z toho, čo je reálne
vyplnené, a v admin formulári je k nemu len `datalist` proti preklepom. „Nadchádzajúce" sa
počíta z `event_dates` (budúci termín v predaji + publikované podujatie), **nie** z
`events.event_date` — ten je len odtlačok najbližšieho termínu a pri odohranom podujatí
ukazuje do minulosti. `deletePerformer` účinkujúceho priradeného k podujatiu nezmaže, len ho
skryje (`active = false`); `on delete cascade` by ho inak vyhodil zo zostavy podujatia, ktoré
sa možno predalo s jeho menom na plagáte.

### Storno a refundácie

`orders.refunded_at` / `refunded_amount` / `refund_reason` / `refunded_by` + `cancellations.functions.ts`
+ `/admin/sales/cancellations`. Píše do nich webový refund (`refundOrder`) aj storno z pokladne
(`voidPosSale`) — pokladňa navyše ponecháva `void_reason` kvôli vlastnému prehľadu.

**`refunded_amount` je kumulatívne.** Čiastočný refund necháva objednávku v stave `paid`, takže
bez súčtu už vrátenej sumy sa dala vrátiť aj viackrát dokola; server teraz počíta zostatok
(`total_amount - refunded_amount`) a nad neho refund neprejde. Prehľad preto nefiltruje podľa
stavu, ale podľa `refunded_amount > 0` — inak by čiastočné refundy vypadli.

Dôvod refundu **nečítaj z `payment_logs`** — to je ladiaci log poskytovateľa platby, nie obchodný
záznam; obchodný záznam je `refund_reason`.

### Termíny podujatí

`event_dates` + `event-dates.functions.ts` + `/admin/events/dates`. Jedno podujatie má zoznam
termínov a **predaj sa viaže na termín, nie na podujatie**: `orders.event_date_id`,
`tickets.event_date_id` aj `seat_inventory.event_date_id` sú `not null` a unikátnosť sedadla je
`(event_date_id, seat_id)`. To isté sedadlo je tak na piatok a sobotu voľné zvlášť.

**`events.event_date` / `event_time` sú len odtlačok najbližšieho termínu.** Udržiava ich trigger
`trg_event_dates_sync_event` (funkcia `sync_event_primary_date`), aby katalóg, zoznamy a
zoraďovanie fungovali bez zmeny. Preto:

- do `events.event_date` **nezapisuj priamo** — meň termín, trigger to premietne (`upsertEvent`
  pri úprave dátum podujatia vôbec neposiela a posunie termín len vtedy, keď je jediný);
- dátum na vstupenku, do e-mailu a do skenera ber cez `loadEventInfo(eventId, eventDateId)`
  z `lib/event-info.server.ts` — inak by po pridaní reprízy zostarli už vydané vstupenky.

Kapacita: `event_dates.total_tickets` má prednosť pred `events.total_tickets` (`NULL` = zdedí sa).
Zrušený termín (`status = 'cancelled'`) sa nepredáva, ale ostáva aj s vydanými vstupenkami —
`deleteEventDate` preto termín s objednávkami odmietne zmazať, rovnako ako posledný termín
podujatia (podujatie bez termínu sa nedá kúpiť).

Obsadenosť pre zákaznícku mapu vracia `getSeatAvailability({ event_date_id })` z databázy;
localStorage v `ticketing-db.ts` už drží len košík tohto prehliadača a kľúčuje sa `event_date_id`.

### Pokladňa (POS)

`pos.functions.ts` + `@/hooks/use-pos` + `/organizer/pos*` a `/admin/pos/*`. **Predaj z pokladne
vytvára tie isté `orders` / `order_items` / `tickets` ako web** — líši sa `channel = 'pos'`,
`payment_method` (`cash` / `card` / `transfer` / `free`), `cashier_id`, `pos_session_id`
a `receipt_number`. Vďaka tomu funguje skener, kapacita, štatistiky aj provízia bez druhej vetvy.
Nikdy nezakladaj samostatnú „POS objednávku" mimo `orders`.

- **Ceny počíta server** rovnako ako pri webovom predaji; pokladňa posiela len čo predáva. Ručná
  zľava pokladníka ide ako percento (`discount_pct`); keď je zadaný kupón (`promo_code`), má
  prednosť a zľavu určí `check_coupon`. Výsledok je vždy v `orders.discount_amount`.
- **PIN pokladníka** hashuje server (`HMAC-SHA256(TICKET_QR_SECRET, "<cashierId>:<pin>")`) a
  overuje v konštantnom čase s limitom 10 pokusov / 15 min. Do prehliadača sa hash nikdy nedostane.
- **Oprávnenia** (`pos_cashiers.permissions`) sa vynucujú na serveri — `sale`, `void`,
  `close_register` atď. Kontrola v UI je len pohodlie.
- **Smena** (`pos_sessions`) je na pokladníka jedna otvorená (parciálny unique index). Prehliadač
  si pamätá len jej id (`mt_pos_session_id`); platnosť potvrdzuje server.
- **Storno** cez `voidPosSale`: objednávka → `refunded`, vstupenky dostanú `refunded_at` (skener
  ich odmietne) a sedadlá sa vrátia do predaja.
- **Uzávierka** (`pos_closings`) je zmrazený doklad — neskorší predaj ani storno ňou nehýbe.
- Čísla dokladov dáva `next_receipt_number(organizer_id)` (rad na organizátora a rok, atomicky).
- **eKasa a platobný terminál sú stále simulácia** (`fiscal-adapter.ts`,
  `payment-terminal-adapter.ts`). Číslo fiškálneho dokladu sa uloží do `orders.fiscal_receipt_id`;
  na reálnu prevádzku treba certifikát a poskytovateľa.

### Zľavové kupóny

`coupons` + `coupon_redemptions` + `coupons.functions.ts` / `coupons.server.ts` a
`/admin/events/coupons`. Kód je jedinečný v celej platforme (`unique (upper(code))`).
Rozsah platnosti: `event_id` → jedno podujatie, inak `organizer_id` → všetky jeho podujatia,
a keď je aj ten `NULL`, ide o kupón platformy (zakladá ho admin).

**Kontrolu aj inkrement robí jedna funkcia v databáze** — `check_coupon(code, event_id, amount,
email, claim)` si riadok kupónu uzamkne (`for update`), overí stav, platnosť, minimálnu sumu,
celkový limit aj limit na e-mail, vypočíta zľavu a pri `claim => true` zvýši `used_count`.
Nikdy nekontroluj kupón dvoma dotazmi — medzi ne sa zmestí súbežný kupujúci a posledné
použitie sa minie dvakrát. Keď objednávka po uplatnení zlyhá, zavolaj `releaseCoupon()`
(všetky chybové vetvy v `submitOrder` aj `createPosSale` to už robia).

Klient posiela **iba kód**, nikdy sumu ani percento. `previewCoupon` je verejný náhľad
(limit 30 pokusov / 10 min na IP, aby sa kódy nedali uhádnuť skriptom) a počítadlo nezvyšuje.
Uplatnenie sa zapíše do `orders.coupon_id` / `discount_amount` / `promo_code` a do
`coupon_redemptions` (unique na `order_id` — na objednávku ide najviac jeden kupón).
V pokladni má kupón prednosť pred ručnou zľavou pokladníka (`discount_pct`).

### Emailové šablóny

`email_templates` + `email-templates.ts` (izomorfné, vstavané znenie + renderer),
`email-templates.server.ts` (`renderEmail`) a `/admin/system/email-templates`.
Kľúče sú `tickets` a `refund`; nový kľúč pridávaj **spolu s kódom, ktorý ho odošle**.

Šablóna v databáze je nepovinná — keď riadok chýba alebo má `enabled = false`, použije sa
`DEFAULT_TEMPLATES` z kódu. Odosielanie tak nikdy nezávisí od toho, či niekto šablónu založil.
Podporujeme len `{{kľúč}}` a `{{#if kľúč}} … {{/if}}`; hodnoty sa do HTML escapujú
(do predmetu a čistého textu nie).

### Zariadenia a dôvody refundácie

`scanner_devices` + `devices.functions.ts` + `/admin/maxiticket/devices`. Skener pri dverách si
čítačku vyberie zo zoznamu (`listScannerDevicesForEvent` sa autorizuje **skenovacím kódom
podujatia**, nie prihlásením — tablet sa neprihlasuje) a jej meno ide do
`ticket_scans.scanner_name`. Posledné použitie zapisuje `touch_scanner_device()` mimo hlavnej
cesty, aby zlyhanie zápisu nezdržalo sken.

`refund_reasons` + `refund-reasons.functions.ts` + `/admin/maxiticket/refund-types`. Číselník
číta ktokoľvek prihlásený, mení ho len admin. Refundačný dialóg posiela do `refundOrder`
názov dôvodu (plus povinnú poznámku pri `requires_note`), takže sa z refundácií dá robiť
štatistika — predtým to bol voľný text.

### Vyúčtovanie organizátorom
`settlements.functions.ts` + `/admin/maxiticket/organizers` (sadzby, fakturačné a výplatné údaje)
a `/admin/maxiticket/protocols` (protokoly). Provízia je **percento na organizátora**
(`profiles.commission_rate`); `NULL` znamená predvolenú sadzbu platformy z `platform_settings`.

Prepočet za obdobie: hrubá tržba = objednávky so stavom `paid`/`refunded`, ktoré sa v období
zaplatili; refundácie sa odpočítavajú podľa **dátumu refundácie** zo záporných riadkov v
`payments` (kvôli čiastočným refundáciám, pri ktorých objednávka ostáva `paid`). Protokol si
čísla pri vytvorení **zmrazí** — neskoršia refundácia nesmie prepísať to, čo bolo odsúhlasené
a vyplatené. Vyplatený protokol sa nedá zmazať.

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
  `event_dates.total_tickets` a až potom `events.total_tickets`; počíta sa **v rámci termínu**
  (vypredaný piatok nesmie zavrieť predaj na sobotu). Kapacita 0 znamená „neobmedzené".
- **Termín** — `submitOrder` si `event_date_id` overí (musí patriť podujatiu, byť `on_sale` a
  nesmie byť v minulosti); bez neho vezme najbližší termín v predaji.
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
`reserve_seats(p_event_id, p_event_date_id, p_order_id, p_seats, p_reserved_until)` (atómická
rezervácia), `sync_event_primary_date()` a `expire_stale_orders()`. Posledná menovaná beží
každých 5 minút cez `pg_cron` (úloha `expire-stale-orders`) a navyše ju oportunisticky volá
`submitOrder`. Zoznam úloh: `select * from cron.job;`

## Konvencie kódu

- Prettier + ESLint; UI komponenty shadcn v `src/components/ui` (needituj ich zbytočne).
- Cesty cez alias `@/`.
- Používateľské texty sú po slovensky (aj chybové hlášky zo server funkcií).
- Komentáre v kóde sú miešané SK/EN — drž sa štýlu okolitého súboru.
- `toast` zo `sonner` na notifikácie.
