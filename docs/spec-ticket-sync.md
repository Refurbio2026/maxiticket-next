# Špecifikácia: zdrojové tabuľky a inkrementálny sync (vstupenky, objednávky, podujatia)

**Účel:** podklad pre externú synchronizáciu dát z MaxiTicket OM4 (MySQL/MariaDB) do iného systému – dátový sklad, nový backend, reporting alebo partnerská integrácia.

**Zdroj:** statická analýza `/opt/om` k 16. 9. 2026 + dodané dumpy `docs/sp-payments-current.sql`, `docs/tables-mt-payments.sql`, `docs/ciselniky.txt`. DDL tabuliek nájomcu (`bt_tickets`) v repozitári **nie je**, preto sú zoznamy stĺpcov odvodené z reálnych SQL dotazov v kóde a z tiel procedúr. Miesta, ktoré takto potvrdiť nejde, sú označené **„neoverené“**.

**Predpoklad čítania:** sync číta **iba** (`SELECT`), do zdrojovej DB nezapisuje a nevyžaduje zmenu schémy. Ak sa zmena schémy povolí, kapitola 8 hovorí, čo by ju najviac zjednodušilo.

---

## 1. Zhrnutie pre netrpezlivých

1. **Hlavný a jediný úplný zdroj vstupeniek je `seat.modified`.** DDL overené na dev aj produkčnej RDS (identické): `datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()`, so samostatným indexom `modified`. Zachytí predaj, storno, refund aj zmenu ceny – vrátane predaja mimo `FinalizeOMSale` (pokladňa, externý predaj, partneri).
2. **`seat.id_seat > lastId` na vstupenky nefunguje.** Riadok v `seat` vzniká už pri založení predstavenia ako voľné miesto (stav 1) a pri predaji sa iba mení.
3. **`seat_note` pokrýva len časť predaja.** Za 30 dní nemalo hlavičku objednávky **2 246 zo 6 124 predaných vstupeniek (36,7 %)** – celý externý predaj a 71 % pokladničného. Kanál B preto riadky s `id_seat_note` iba **obohacuje**; pre ostatné sa objednávka odvodzuje zo `seat` (6.1).
4. **`seat.modified` nesie stav, nie dôvod zmeny.** Preto ostávajú samostatné kanály udalostí: `storno_seat_log` (kurzor `id_storno_seat_log`), `seat_history` a `seat_scan` (kurzor `id_seat_scan`).
5. **Podujatia majú `plan.modified`**, ale je nullable, takže filter musí byť `COALESCE(plan.modified, plan.created)`. `drama` časovú značku nemá vôbec.
6. **`seat` má cudzí kľúč na `plan` s `ON DELETE CASCADE`** – zrušenie predstavenia zmaže miesta bez akejkoľvek stopy. Rekonciliácia preto ostáva, ale už len ako **hodinová kontrola počtov**, nie ako hlavný mechanizmus.

---

## 2. Zdrojové tabuľky

### 2.1 Vstupenky

#### `seat` – miesto v predstavení, po predaji je to vstupenka
Riadok existuje pre **každé miesto každého predstavenia**, bez ohľadu na predaj. Stav rozhoduje o tom, či ide o vstupenku.

| Stĺpec | Význam pre sync |
|---|---|
| `id_seat` | PK. **Nie je identifikátor predaja** – pri storne sa miesto vráti do stavu 1 a ten istý riadok sa môže predať znovu. |
| `id_plan` | predstavenie |
| `id_theater_seat` | statická definícia miesta v hale (rad, číslo, súradnice) |
| `id_seat_status` | **stav vstupenky** (3.1) |
| `id_seat_note` | objednávka (hlavička); NULL pri nepredanom mieste |
| `id_invoice` | faktúra |
| `id_person`, `id_person2` | zákazník a držiteľ mennej vstupenky |
| `price`, `discount`, `system_cost`, `printed_price` | cena a zľava. `final_price` / `basic_price` **nie sú stĺpce `seat`**, patria dočasnému košíku `to_sale`. |
| `id_discount`, `id_discount2` | zľavy |
| `id_payment` | platobná metóda. **Pozor:** pri dokončení rezervácie z bankového výpisu sem kód zapíše ID bankového účtu (`app/models/Superadmin/UnprocessedPayments.php:365`), takže hodnota nemusí byť ID z `payment`. |
| `id_expenses` | poplatok viazaný na miesto |
| `barcode` | čiarový kód vstupenky. **Pri storne sa zvýši o 1** (`admin/app/models/Storno.php:62`), takže nie je stabilným kľúčom. |
| `scan` | **počítadlo kontroly vstupu**, nie čas. `> 0` = vstupenka bola skenovaná. |
| `id_reservation` | väzba na rezerváciu (NULL po predaji) |
| `id_seat_category`, `id_gate_group`, `id_promoter`, `id_affiliate` | kategória, brána, organizátor, affiliate |
| `mifare`, `id_mifare` | čipová karta pri permanentkách |
| `visible`, `visible_online`, `printed`, `id_printer_queue`, `id_job_state`, `id_abo_date`, `id_parent_seat`, `id_sys_user` | ostatné |
| `changed` | **nespoľahlivé** – pozri 4. Prenášaj ako dátový stĺpec, nie ako kurzor. |
| `modified` | **overené (dev aj prod RDS):** `datetime NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()`, samostatný index `modified`. Posúva ho každý UPDATE riadku. **Hlavný zdroj delty pre vstupenky.** |

Zdroje: `app/models/Superadmin/UnprocessedPayments.php:1044-1077`, `app/models/Superadmin/BarcodeInfo.php:104-140`, `admin/app/models/Storno.php:62-81`.

**Cudzí kľúč (overené, dev aj prod RDS):** `seat` má FK na `plan` s `ON DELETE CASCADE`. Zmazanie predstavenia teda zmaže všetky jeho miesta vrátane predaných vstupeniek a v `seat` po nich neostane žiadna stopa. Sync to musí riešiť kontrolou počtov (5.6).

#### `seat_history` – história zmien miesta
Stĺpce ako `seat` plus `id_seat_history` (PK), `id_storno_user`, `operation_type`. Nemá `modified`, `scan`, `visible`, `id_reservation`, `mifare`.

- Zapisuje sa pri storne a znižovaní ceny (`app/models/Superadmin/Refund.php:95,99`, `app/models/Superadmin/UnprocessedPayments.php:400,484`).
- **`changed` sa kopíruje zo `seat.changed`**, nie `now()`. Nie je to teda čas vzniku riadku histórie.
- Či sa do tabuľky zapisuje aj pri **predaji**, závisí od procedúr mimo repozitára (`UpdateSeatRC`) – **neoverené**.
- `operation_type`: kód zapisuje vždy `1`, pri čítaní sa vylučujú `0, 3, 4` (`procedure.txt:614`, `admin/app/controllers/EventReportController.php:431`). Význam hodnôt je **neoverený**.

#### `storno_seat_log` – snímka vstupenky pred stornom
`id_seat, id_seat_status, id_sys_user, id_person, id_person2, id_discount, id_discount2, id_invoice, id_reservation, id_seat_note, id_payment, id_expenses, mifare, id_mifare, price, discount, printed, barcode, log_user_id`.

- Vzniká tesne pred uvoľnením miesta (`admin/app/models/Storno.php:50`, `app/models/Superadmin/UnprocessedPayments.php:390,475`).
- **Overené (dev aj prod RDS):** tabuľka má PK `id_storno_seat_log` (bigint auto_increment) a `created datetime DEFAULT current_timestamp()`, charset `utf8mb4`. Kód ani jedno nevkladá, dopĺňa ich DB. Kurzor preto ide podľa `id_storno_seat_log` a `created` je spoľahlivý čas storna.
- **Nekonzistencia:** storno pre organizátora zapisuje iba `storno_seat_log`, nie `seat_history`.

#### `seat_scan` – história kontrol vstupu
`online, id_plan, id_gate, barcode, id_seat, scan_type, scan_time`.

- `scan_time`: online `now()`, offline `FROM_UNIXTIME()` z dávky (`app/controllers/ScanApiController.php:256,281,350,412`).
- `scan_type`: 0 = sken, 1 = zrušenie skenu. `online`: 1 = online, 0 = offline dávka.
- **`id_seat` sa vkladá vždy ako NULL** – väzba na vstupenku je len cez `barcode` a `id_plan`.
- Zariadenie (`deviceId`) sa **neukladá**.
- XML-RPC cesta (`markBarcode`, `scanBarcode`) do `seat_scan` **nezapisuje vôbec**, históriu loguje iba Scan API.
- **Overené (dev aj prod RDS):** PK je `id_seat_scan` (int auto_increment) → kurzor podľa ID. `scan_time` je len dátový stĺpec s časom udalosti.
- **Index je (`id_gate`, `barcode`), nie (`id_plan`, `barcode`)** – dopárovanie skenu na vstupenku podľa predstavenia a čiarového kódu teda index nevyužije. Páruj v cieľovom systéme, nie dotazom do zdroja.

#### `turnstile_seat` – vstupenky exportované do turniketov
`id_turnstile_seat, id_turnstile_event, id_seat, id_reservation_ext, id_place_ext, state, id_ticket_ext, reserved_until, reserved_session, price, barcode, operation, id_export_group, id_discount, mifare, modified`.

- `modified` + `operation = 1` nastavuje iba `FinalizeOMSale` (`docs/sp-payments-current.sql:715`). PHP zapisovatelia `modified` neposúvajú, takže ako inkrementálny ukazovateľ je nespoľahlivý.

### 2.2 Objednávky

#### `seat_note` – hlavička objednávky
`id_seat_note` (PK, auto_increment), `note` (variabilný symbol), `id_basket` (číslo objednávky; NULL pri nezaplatenej rezervácii), `referral`, `ip_address` (binárne, `INET6_ATON`), `id_affiliate`.

- Vzniká výlučne vo `FinalizeOMSale` (`docs/sp-payments-current.sql:584`).
- **Nemá žiadnu časovú značku.** Čas objednávky sa v celom projekte odvodzuje z `invoice.changed`, `seat.changed` alebo `mt_payments.basket.ts`.

#### `invoice` – faktúra / doklad objednávky
`id_invoice, id_person, id_plan, changed, price, discount, total, id_expenses, reservation, order_number, paid, id_payment, id_sys_user, email, name, surname, street, city, zip, country_code, company, phone, invoice_year, invoice_number, printed, dispatch_date, id_eph, tracking_number, tracking_status, reservation_reminder, reservation_cancel, pdf, xsd`.

- Vzniká **iba** ak sa vytvára faktúra, rezervácia alebo je vyplnené doručenie – online predaj bez faktúry a doručenia faktúru nemá (`docs/sp-payments-current.sql:561`). Dáta za 30 dní to potvrdzujú: z 3 210 online predajov nemá faktúru **3 201 (99,7 %)**, pokladničný a externý predaj ju nemá nikdy. **`invoice` preto nie je nositeľom objednávky** a nedá sa použiť ani ako náhrada hlavičky.
- `paid` = čas úhrady (pri online predaji `now()`, pri rezervácii NULL a dopĺňa sa po spárovaní platby).
- `reservation`: 0 = predaj, 2 = rezervácia.
- `invoice_number` je **sekvencia v rámci roka**, dopĺňa sa ako `max + 1` (`app/models/Superadmin/Invoice.php:53`), nie auto_increment.
- `changed` sa nastavuje **len pri vzniku**, žiadny UPDATE ho neprepisuje.

#### Ďalšie tabuľky objednávky
| Tabuľka | Kľúčové stĺpce | Poznámka |
|---|---|---|
| `order_note` | `id_order_note, id_basket, id_seat_note, note, done, created, modified` | poznámka zákazníka; `created` má DB default (**neoverené**), `modified` sa nastavuje pri prepise |
| `seat_note_refund` | `id_seat_note_refund, id_seat_note, id_plan, date_request, days_to_refund, processed, id_sys_user, date_refund, date_refund_email, iban` | žiadosť o vrátenie peňazí; tri použiteľné časové značky |
| `seat_refund` | `id_seat, id_plan, id_seat_note_refund, id_seat_note, processed, price, changed, id_payment, id_person, id_sys_user` | `changed` je **kópia `seat.changed`**, nie čas refundu |
| `person` | `id_person, name, surname, e_mail, login, phone, mobile, street, city, zip, country_code, sex, date_of_birth, active, company, …` | **bez časovej značky**; zápis cez procedúru `HandlePersonOM` (telo neoverené) |
| `to_sale`, `to_sale_recovery` | `machine, id_seat, id_plan, id_basket, datum, final_price, basic_price, id_seat_status, id_discount, id_voucher, …` | dočasný košík; `datum` je expirácia, nie audit. Po dokončení predaja sa riadky `to_sale` **mažú**. |
| `basket_serialization` | `id, machine, data, created, modified` | serializovaný košík; `id` = číslo objednávky z `GetBasketId()` |
| `mt_payments.basket` | `id_basket` (auto_increment), `ts` (DEFAULT CURRENT_TIMESTAMP), `id_global_theater` | **globálny generátor čísiel objednávok naprieč nájomcami**; `ts` je jediná spoľahlivá značka času vzniku objednávky |
| `mt_payments.bank_statement` | `id_basket`, `amount`, `date`, `vs`, … | prijaté platby; párovanie popisuje `docs/spec-parovanie-vypisov.md` |

### 2.3 Podujatia

#### `plan` – termín predstavenia
- Väzby: `id_plan`, `id_drama`, `id_hall_desc`, `id_price_category`, `id_promoter`, `id_promoter_ticket`, `id_subdomain`, `id_plan_group`, `id_performer`.
- Čas: `datum`, `start`, `end`, `door_time`, `sell_start`, `sell_end`, `revision_date`.
- Predaj a viditeľnosť: `stop_sell`, `show_online` (0, 6, 7), `show_hash`, `allow_remote`, `allow_export`, `require_access_code`, `ticket_limit`, `top_perf`, `acc_status`, `statistics`, `radius_km`.
- Ostatné: `token` (kontrola vstupu), `abo_mask` (permanentka), `vat`, `tickets_with_places`, `no_print_date`, `no_print_time`, `director`.
- **`plan` nemá `enabled`, `visible` ani `deleted`.**
- **Časové značky: `created` a `modified`, pričom `modified` môže byť NULL** (`app/controllers/UltraadminController.php:95` používa `IF(plan.modified IS NULL, plan.created, plan.modified)`).
- Doplnkové: `plan_history` (`created`, `datum` – história prekladania termínov), `plan_sys_user`, `plan_performer`.

#### `drama` – podujatie
`id_drama, name, name_part1..3, name_seo, id_drama_category, id_drama_category_genre, id_drama_category_online, id_drama_category_children, id_event_type, id_drama_picture (+ *_ticket, 1..3), description, description_short, url_video, url_detail, url_fbevent, bg_color, tickets, percentage`.

**Bez akejkoľvek časovej značky.**

#### Sála, kategórie, ceny
| Tabuľka | Kľúčové stĺpce | Časová značka |
|---|---|---|
| `hall` | `id_hall, id_hall_desc, layout, js, picture, seat_width, seat_height, online_visible, show, …` | `created` + `modified` (nullable) |
| `hall_desc` | `id_hall_desc, name, hall_Name, hall_Street, hall_City, hall_ZIP, country_code, lat, lon, visible` | nemá |
| `hall_meta` | – | `created` + `updated` |
| `theater_seat` | `id_theater_seat, id_hall, id_hall_meta, id_loc1, id_loc2, id_side, id_seat_category, number, order, pos_x, pos_y, visible, visible_online, deleted` | nemá |
| `seat_category` | `id_seat_category, name, id_hall, id_plan, id_seat_type, color, order_no` | nemá |
| `price_category` | `id_price_category, name, year, id_hall, id_promoter, pricelist, id_price_currency` | nemá |
| `price` | `id_price_category, id_seat_category, price, percentage, id_sell_type, id_service_type, id_promoter` | nemá |

**Tabuľka `price_type` neexistuje** (v `seat` je `id_price_type` len v dočasnom košíku `to_sale`).

#### Vlastníctvo a zobrazenie
- `promoter` – organizátor (`plan.id_promoter`), fakturačne `plan.id_promoter_ticket`. Bez časovej značky.
- `subdomain` – kde sa podujatie zobrazuje. `plan.id_subdomain IS NULL` znamená „všade“ (`app/models/Events.php:562`). Bez časovej značky.
- `external_event` – podujatie predávané inde: `id_external_event, id_drama, id_hall (→ hall_desc), start_datetime, price_amount, currency, external_url, link_target, visible, id_subdomain, created, modified`. **Jediná tabuľka podujatí s korektným `ON UPDATE CURRENT_TIMESTAMP`** (`docs/external-event-migration.sql`).

---

## 3. Stavy

### 3.1 Stav vstupenky – `seat.id_seat_status` → `seat_status`
Číselník `seat_status` (`id_seat_status, name, color, invoice, ticket, customer, mifare, reservation, id_price_type, price_discount, discount_tag, enabled, reservation_day, order_position`) má 28 hodnôt (`docs/ciselniky.txt`). Pre sync sú podstatné:

#### Filter predaných vstupeniek: `seat_status.ticket = 1`
Príznak `ticket` v číselníku znamená „na toto miesto sa tlačí vstupenka“. Trinásť stavov (`enabled` je stav číselníka, nie vstupenky):

| Hodnota | Názov | `enabled` | Konštanta (`app/models/SeatStatus.php`) |
|---|---|---|---|
| 6 | Predaj (pokladňa) | 1 | `SEAT_BUY` |
| 7 | Voľná vstupenka | 1 | – |
| 9 | Predaj Skybox | 0 | – |
| 13 | Direktor | 0 | – |
| 15 | Externý predaj | 1 | `SEAT_STORNO` – **konštanta nesedí s číselníkom a ide pravdepodobne o chybu** (9.2). Prenášaj s príznakom `suspicious`, pozri nižšie. |
| 17 | Predaný kontingent | 0 | – |
| 18 | Organizátor | 1 | – |
| 19 | Kommissionsverkauf | 0 | – |
| 21 | Predaj rýchlej rezervácie | 0 | – |
| 23 | Internetový predaj | 1 | `SEAT_ONLINE_BUY` |
| 24 | Voľné ABO | 0 | – |
| 27 | Online ABO mifare | 1 | `SEAT_ONLINE_ABO_MIFARE` |
| 28 | Predaj bez OP | 0 | `SEAT_SALE_WO_IDCARD` |

#### Filter syncu – explicitný zoznam stavov
Samotné `ticket = 1` ako podmienku **nepoužívaj**: stav 26 (predaná online permanentka) má `ticket = 0` a rezervácie treba sledovať tiež, aby cieľ videl celý životný cyklus miesta.

```sql
id_seat_status IN (
   6, 7, 9, 13, 15, 17, 18, 19, 21, 23, 24, 27, 28,  -- predaj (ticket = 1)
   5, 14, 26,                                        -- permanentky (ABO), ticket = 0
   11, 20                                            -- rezervácie, ticket = 0
)
```

| Skupina | Stavy | Klasifikácia v cieli |
|---|---|---|
| Predaj | 6, 7, 9, 13, 15, 17, 18, 19, 21, 23, 24, 27, 28 | `sold` – vstupenka, ráta sa do tržby |
| Permanentky | 5, 14, 26 | `abo` – samostatná kategória, nemiešať s bežným predajom |
| Rezervácie | 11, 20 | **`pending` – nie je predaj**, do tržby nevstupuje |

Pripomienka k 5.1: filter patrí do klasifikácie v cieli, **nie do `WHERE` zdrojového dotazu**. Kanál A musí vidieť aj prechod do stavu 1, inak sa storno neprejaví.

**Stav 15 „Externý predaj“ – prenášaj s príznakom:**
```
suspicious = (id_seat_status = 15 AND price = 0 AND id_seat_note IS NULL)
```
Dôvod: `app/models/Turnstile/Triton.php:657` nastavuje pri zrušení rezervácie z turniketu konštantu `SEAT_STORNO = 15`, ktorá je v číselníku „Externý predaj“ s `ticket = 1`. Za 90 dní má **všetkých 1 343 riadkov v stave 15 `price = 0` a žiadny `id_seat_note`**, čo tomu presne zodpovedá. Takéto riadky teda takmer isto nie sú predaj – nerátaj ich do tržby a nechaj ich na kontrolu (9.2). Skutočný externý predaj by mal cenu > 0.

#### Stavy, ktoré nie sú predaj
| Hodnota | Názov | `ticket` | Prečo je podstatný |
|---|---|---|---|
| 1 | Voľné sedadlo | 0 | nepredané, aj po storne. Do syncu vstupeniek nepatrí, ale kanál A ho musí vidieť – je to výsledok storna. |
| 2 | Blokované sedadlo | 0 | **Nesynchronizuje sa ako vstupenka**, ráta sa iba v kontrole počtov (5.6). Pozri upozornenie nižšie. |
| 11 | Rezervácia | 0 | čaká na platbu prevodom → `pending`, je vo filtri |
| 20 | Rýchla rezervácia | 0 | → `pending`, je vo filtri; predajom prechádza do stavu 21 |
| 25 | Internetová rezervácia | 0 | v číselníku vypnuté, v dátach sa nevyskytuje |
| 26 | Online ABO | 0 | predaná permanentka → `abo`, je vo filtri napriek `ticket = 0` |

⚠️ **Stav 2 a `id_seat_note`.** Za 90 dní bol stav 2 najčastejšie menený stav vôbec (18 774 riadkov) a **8 305 z nich (44 %) má vyplnené `id_seat_note`**, pričom **žiadny nemá cenu**. Podľa prevádzky ide o expirované online objednávky; `FinalizeOMSale` navyše nastavuje stav 2 rodičovským miestam permanentiek a miestam skupiny predstavení s cenou 0, čo tiež sedí (ktorá cesta prevláda, je **neoverené**).

Dôsledok pre kanál B: **klasifikuj výhradne podľa `id_seat_status`, nikdy podľa prítomnosti `id_seat_note`.** Riadok so stavom 2 nesmie byť predajom ani vtedy, keď hlavičku objednávky má. Opačná chyba je rovnako reálna: 36,7 % skutočného predaja hlavičku nemá (5.2).

Mapovanie stavov je aj v konfigurácii (`seat.status.buy = 23`, `seat.status.reservation = 25`, `seat.status.export = 19`), preto ho sync **nesmie mať natvrdo v kóde**; načítajte `seat_status` ako číselník a filter odvoďte zo stĺpca `ticket`.

**Odvodený stav vstupenky pre cieľový systém:**
```
predaná        = id_seat_status IN (6,7,9,13,15,17,18,19,21,23,24,27,28)   -- ticket = 1
                 (id_seat_note NIE JE podmienkou – chýba 36,7 % predaja)
suspicious     = id_seat_status = 15 AND price = 0 AND id_seat_note IS NULL -- zrušená rezervácia z turniketu
permanentka    = id_seat_status IN (5, 14, 26)
rezervovaná    = id_seat_status IN (11, 20)    -- pending, nie predaj
blokovaná      = id_seat_status = 2            -- nesynchronizuje sa ako vstupenka, len kontrola počtov
stornovaná     = predtým predaná, teraz id_seat_status = 1 (alebo riadok v storno_seat_log)
skontrolovaná  = seat.scan > 0 (čas iba v seat_scan.scan_time)
refundovaná    = existuje riadok v seat_refund / seat_note_refund
```

### 3.2 Stav objednávky
Explicitný stĺpec neexistuje, odvodzuje sa:
- `seat_note.id_basket IS NULL` → nezaplatená rezervácia,
- `invoice.paid IS NULL` → neuhradené, `paid` vyplnené → uhradené,
- `invoice.reservation` 0 = predaj, 2 = rezervácia,
- `invoice.reservation_reminder` / `reservation_cancel` → pripomienka a zrušenie rezervácie,
- `seat_note_refund.date_refund` → vrátené peniaze.

### 3.3 Stav podujatia
`stop_sell` (zastavený predaj), `show_online` (0, 6, 7 – **význam hodnôt neoverený**), `show_hash` (prístup len cez odkaz), `sell_start` / `sell_end`, `allow_remote` a `allow_export` (partnerský predaj), `require_access_code`.

---

## 4. Časové značky – čo sa dá a čo sa nedá použiť

| Tabuľka | Značka | Použiteľná na delta sync? |
|---|---|---|
| `seat` | `changed` | **Nie.** Explicitne ju nastavuje jediné miesto v PHP (`UnprocessedPayments.php:365`); storno ani sken ju nemenia; hlavné nastavovanie je v procedúrach mimo repozitára (neoverené). |
| `seat` | `modified` | **Áno – hlavný kurzor syncu.** Overené DDL: `NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp()`, index `modified`. |
| `seat_note` | – | **Nemá žiadnu.** |
| `invoice` | `changed` | Len čas vzniku, UPDATE ju neprepisuje. |
| `invoice` | `paid`, `dispatch_date`, `reservation_reminder`, `reservation_cancel` | Áno, ale len pre konkrétnu udalosť. |
| `seat_history` | `changed` | **Nie** – kopíruje `seat.changed`. |
| `storno_seat_log` | `created` | **Áno** (DB default). Kurzorom je však PK `id_storno_seat_log`. |
| `seat_scan` | `scan_time` | **Áno** ako čas udalosti. Kurzorom je PK `id_seat_scan`. |
| `turnstile_seat` | `modified` | Nie – posúva ju iba predaj, nie zmeny z turniketu. |
| `order_note` | `created`, `modified` | Áno (default v DB neoverený). |
| `seat_note_refund` | `date_request`, `date_refund_email`, `date_refund` | Áno. |
| `plan` | `created`, `modified` (nullable) | **Áno, cez `COALESCE(modified, created)`.** |
| `hall` | `created`, `modified` | Áno. |
| `drama`, `promoter`, `subdomain`, `theater_seat`, `seat_category`, `price_category`, `price`, `payment`, `expenses`, `person` | – | **Nemajú.** |
| `external_event` | `created`, `modified` | Áno, jediná s `ON UPDATE`. |
| `mt_payments.basket` | `ts` | Áno – čas vzniku čísla objednávky. |

**Ako to rieši projekt dnes** (vzory, ktoré sa dajú prevziať):
- **JSON-RPC pre partnerov** – fronta v DB s potvrdením: `ExtGetSeatExportList` vráti nepotvrdené zmeny s `id_export_group`, po úspechu `ExtConfirmSeatExportList`, pri chybe `ExtRollbackSeatExportList` (`app/models/JsonRpcHelper.php:525-716`). Najzrelší vzor v projekte, ale logika je v procedúrach mimo repozitára.
- **Colosseo** – tá istá schéma nad fyzickou frontou `mt_export.export_seat` + `mt_export.export_group`.
- **Skidata** – žiadna delta: vyberie predstavenia v okne −3 / +2 dni a **porovná snímku `turnstile_seat` proti `seat`** (`app/models/Turnstile/Skidata.php:228-236`), dávka max. 350 riadkov.
- **ITC** – žiadna delta, porovnáva všetky budúce predstavenia v PHP.
- **Kĺzavé časové okno** (`changed > NOW() - INTERVAL 1 WEEK`) na desiatkach miest.
- **Vzor „posledné spracované ID“ sa v repozitári nepoužíva nikde** – tento dokument ho zavádza ako nový.

---

## 5. Návrh inkrementálneho syncu

Sync má **päť nezávislých kanálov** plus kontrolu počtov. Každý kanál má vlastný kurzor a vlastnú frekvenciu.

Kurzory sa držia **v cieľovom systéme** (zdrojová DB sa nemení):

```sql
-- v cieľovej DB
sync_cursor(
  channel      text primary key,   -- 'tickets' | 'orders' | 'ticket_events' | 'checkins' | 'events'
  last_id      bigint,
  last_ts      timestamptz,
  updated_at   timestamptz
)
```

### 5.1 Kanál A – vstupenky (`seat.modified`, hlavný kanál)

**Kľúč:** `seat.modified` (`ON UPDATE current_timestamp()`, vlastný index). Zachytí každú zmenu miesta: predaj cez `FinalizeOMSale`, predaj na pokladni aj cez partnerské rozhranie, dopárovanie platby k rezervácii, storno, refund aj zmenu ceny.

Je to **jediný úplný zdroj vstupeniek pre všetky predajné stavy** (`seat_status.ticket = 1`, zoznam v 3.1). Ostatné kanály sú doplnkové a žiadny z nich nepokrýva celý predaj.

```sql
SELECT s.id_seat, s.id_plan, s.id_theater_seat, s.id_seat_status, s.id_seat_note,
       s.id_invoice, s.id_person, s.id_person2, s.price, s.discount, s.system_cost,
       s.id_discount, s.id_discount2, s.id_payment, s.id_expenses, s.barcode,
       s.scan, s.id_seat_category, s.id_reservation, s.changed, s.modified
  FROM seat s
 WHERE s.modified >= :lastModified - INTERVAL 5 MINUTE
 ORDER BY s.modified, s.id_seat
 LIMIT 5000;
```

**Pravidlá:**
- Kurzor je dvojica (`modified`, `id_seat`). V jednej sekunde môže byť veľa riadkov, preto sa triedi aj podľa PK a dávka sa dočítava, kým vracia plný počet.
- **Prekryv 5 minút** kryje riadky, ktoré sa potvrdili neskôr, než bola prečítaná ich hodnota `modified` (dlhá transakcia). Upsert v cieli duplicity zahodí.
- `modified` sa neposunie, ak UPDATE zapíše rovnaké hodnoty – dáta sa vtedy nezmenili.
- Kanál nesie **stav, nie dôvod** zmeny. Dôvod dopĺňa kanál C.
- **Bez filtra na stav v `WHERE`.** Dotaz číta všetky zmenené riadky vrátane prechodu do stavu 1 (storno) a 2 (blokované). Klasifikácia „čo je predaná vstupenka“ (stavy s `ticket = 1`) patrí až do cieľa – filter v zdrojovom dotaze by storná zneviditeľnil.
- Vstupenky sa **nikdy** nečítajú podľa `seat.id_seat > lastId` (riadok vzniká so založením predstavenia).
- Zmazané riadky kanál nevidí – pozri 5.6 a 5.7.

### 5.2 Kanál B – hlavičky objednávok (`id > lastId`)

**Kľúč:** `seat_note.id_seat_note`; tabuľka nemá žiadnu časovú značku. Kanál **obohacuje iba tie vstupenky z kanála A, ktoré majú vyplnené `id_seat_note`** – dopĺňa im hlavičku objednávky, faktúru a zákazníka. Vstupenky bez hlavičky nie sú chyba ani strata dát, objednávka sa pre ne odvodzuje zo `seat` (6.1).

**Pokrytie `seat_note` – produkčné dáta za 30 dní (stavy s `ticket = 1`):**
| Stav | Predaných | Bez `seat_note` | Bez `invoice` |
|---|---|---|---|
| 23 Internetový predaj | 3 210 | 0 | 3 201 |
| 6 Predaj (pokladňa) | 2 281 | 1 613 (71 %) | 2 281 |
| 15 Externý predaj | 576 | 576 (100 %) | 576 |
| 7 Voľná vstupenka | 46 | 46 (100 %) | – |
| 21 Predaj rýchlej rezervácie | 11 | 11 (100 %) | – |
| **Spolu** | **6 124** | **2 246 (36,7 %)** | – |

Závery: online predaj hlavičku vytvára **vždy**, pokladničný len v 29 % prípadov, externý predaj a voľné vstupenky **nikdy**.

**Rozloženie zmien za 90 dní** (počet riadkov zmenených podľa `seat.modified`, bez stavu 1; v zátvorke so `seat_note` / s cenou > 0):

| Stav | Zmenených | So `seat_note` | S cenou |
|---|---|---|---|
| 2 Blokované sedadlo (`ticket = 0`) | 18 774 | 8 305 | 0 |
| 23 Internetový predaj | 5 536 | 5 536 | 4 979 |
| 6 Predaj (pokladňa) | 4 518 | 1 175 | 3 511 |
| 15 Externý predaj | 1 343 | 0 | 0 |
| 11 Rezervácia (`ticket = 0`) | 676 | 557 | 477 |
| 7 Voľná vstupenka | 63 | 0 | 0 |
| 21 Predaj rýchlej rezervácie | 11 | 0 | 11 |
| 20 Rýchla rezervácia | 4 | – | – |
| 18 Organizátor | 1 | – | – |

Čo z toho vyplýva pre sync:
- **Objem tvoria blokovania, nie predaj.** Stav 2 je 57 % všetkých zmien, preto sa kanál A nesmie navrhovať na objem predaja.
- **Stav 15 je celý podozrivý** (0 cien, 0 hlavičiek) – pozri pravidlo `suspicious` v 3.1.
- **Voľné vstupenky (stav 7) nemajú cenu** – do tržby nevstupujú, ale vstupenka to je.
- **ABO stavy (5, 14, 26) sa za 90 dní nevyskytli.** Vo filtri zostávajú, lebo `FinalizeOMSale` stav 26 nastavuje pri `plan.abo_mask = 1`.

```sql
-- 1) hlavičky objednávok
SELECT sn.id_seat_note, sn.note, sn.id_basket, sn.referral, sn.id_affiliate,
       INET6_NTOA(sn.ip_address) AS ip_address
  FROM seat_note sn
 WHERE sn.id_seat_note > :lastId
 ORDER BY sn.id_seat_note
 LIMIT 1000;

-- 2) faktúra a zákazník
SELECT i.* FROM invoice i WHERE i.id_invoice IN (:invoiceIds);
SELECT p.id_person, p.name, p.surname, COALESCE(p.login, p.e_mail) AS email, p.phone
  FROM person p WHERE p.id_person IN (:personIds);

-- 3) čas objednávky (jediný spoľahlivý)
SELECT b.id_basket, b.ts FROM mt_payments.basket b WHERE b.id_basket IN (:baskets);
```

**Pravidlá:**
- Kurzor sa posúva až po úspešnom zapísaní celej dávky do cieľa.
- **Bezpečnostný prekryv:** kvôli súbežným transakciám sa môže riadok s nižším ID potvrdiť neskôr ako riadok s vyšším ID. Každý beh preto začína od `lastId − 500`; idempotentný upsert prekryv zahodí. Hodnotu kalibrujte podľa špičkovej frekvencie objednávok.
- Vstupenky **neťahajte cez `id_seat_note IN (...)`** – prídu kanálom A. Tu sa načítava iba hlavička.
- Ak kanál A prinesie vstupenku s `id_seat_note`, ktoré cieľ ešte nepozná, dotiahnite hlavičku adresne podľa ID a kurzor nechajte tak.
- **Vstupenka bez objednávky je platný a bežný stav** (36,7 % predaja), nie chyba syncu. Cieľový model musí `Order` pripúšťať ako nepovinný a odvodenú objednávku odlíšiť príznakom (6.1).

### 5.3 Kanál C – dôvod zmeny: storná a refundy

Kanál A povie, že miesto je zrazu voľné. Tento kanál povie prečo, kedy a kto to urobil.

```sql
-- C1: storná (pokrýva aj storná organizátora, ktoré do seat_history nejdú)
SELECT l.id_storno_seat_log, l.id_seat, l.id_seat_status, l.id_seat_note, l.id_invoice,
       l.id_payment, l.id_person, l.price, l.discount, l.barcode, l.log_user_id, l.created
  FROM storno_seat_log l
 WHERE l.id_storno_seat_log > :lastStornoId
 ORDER BY l.id_storno_seat_log
 LIMIT 1000;

-- C2: história zmien (zmeny ceny, storná cez superadmin)
SELECT h.id_seat_history, h.id_seat, h.id_plan, h.id_seat_note, h.id_seat_status,
       h.price, h.discount, h.id_invoice, h.id_payment, h.operation_type,
       h.id_storno_user, h.changed, h.barcode
  FROM seat_history h
 WHERE h.id_seat_history > :lastHistoryId
 ORDER BY h.id_seat_history
 LIMIT 1000;

-- C3: refundy
SELECT r.id_seat_note_refund, r.id_seat_note, r.id_plan, r.date_request,
       r.processed, r.date_refund, r.date_refund_email
  FROM seat_note_refund r
 WHERE r.id_seat_note_refund > :lastRefundId
    OR r.date_refund       >= :since
    OR r.date_refund_email >= :since;
```

**Pravidlá a upozornenia:**
- **`storno_seat_log.created` je jediný spoľahlivý čas storna.** Používaj ho ako čas udalosti.
- `seat_history.changed` **nie je** čas zmeny (kopíruje `seat.changed`). Prenášaj ho ako `original_changed` a čas udalosti ber z `storno_seat_log.created`, prípadne z `seat.modified` spárovaného riadku.
- `storno_seat_log` je nutný aj popri `seat_history`, lebo **storno pre organizátora do `seat_history` nezapisuje**.
- Po storne sa `seat.barcode` zvýši o 1. Čiarový kód preto verzionuj a nepoužívaj ako kľúč; pôvodnú hodnotu drží `storno_seat_log.barcode`.
- Tabuľka je `utf8mb4`, kým `seat` je `cp1250` – pozri 5.9.

### 5.4 Kanál D – kontrola vstupu (check-in)

```sql
SELECT sc.id_seat_scan, sc.id_plan, sc.id_gate, sc.barcode,
       sc.scan_type, sc.online, sc.scan_time
  FROM seat_scan sc
 WHERE sc.id_seat_scan > :lastScanId
 ORDER BY sc.id_seat_scan
 LIMIT 5000;
```

**Pravidlá:**
- Kurzor je PK `id_seat_scan`. Žiadny časový prekryv nie je potrebný: aj offline dávka nahraná so spätným časom dostane nové, vyššie ID.
- **`scan_time` je čas udalosti, nie poradie doručenia.** Cieľový systém musí stav vstupenky počítať v poradí podľa `scan_time` (sken vs. zrušenie skenu), nie podľa ID.
- **Väzba na vstupenku:** `sc.id_seat` je vždy NULL, preto sa páruje cez `id_plan` a `barcode`. Ak sa miesto medzitým stornovalo a čiarový kód sa zvýšil, historický sken sa už nespáruje – ulož ho ako „sken bez väzby“ a dopáruj cez `storno_seat_log.barcode` alebo `seat_history.barcode`.
- **Páruj v cieli, nie dotazom do zdroja:** index na `seat_scan` je (`id_gate`, `barcode`), takže JOIN cez `id_plan` a `barcode` by čítal tabuľku bez indexu.
- `seat.scan` je len počítadlo. Zdrojom pravdy je `seat_scan`; `seat.scan > 0` slúži na kontrolu konzistencie.

### 5.5 Kanál E – podujatia

```sql
-- predstavenia (má časovú značku)
SELECT p.id_plan, p.id_drama, p.id_hall_desc, p.id_price_category, p.id_promoter,
       p.id_subdomain, p.id_plan_group, p.datum, p.start, p.`end`, p.door_time,
       p.sell_start, p.sell_end, p.stop_sell, p.show_online, p.show_hash,
       p.allow_remote, p.allow_export, p.abo_mask, p.ticket_limit,
       p.created, p.modified
  FROM plan p
 WHERE COALESCE(p.modified, p.created) > :lastEventTs
 ORDER BY COALESCE(p.modified, p.created)
 LIMIT 1000;
```

- **`drama`, `promoter`, `subdomain`, `hall_desc`, `seat_category`, `price_category` a `price` nemajú časovú značku.** Riešenie: pri každom zmenenom `plan` znovu načítajte celý jeho kontext (nadradené podujatie, sála, cenník) a raz denne urobte **plný refresh týchto malých číselníkov** – sú rádovo v tisícoch riadkov.
- Zmena, ktorá sa dotkne len `drama` (napr. preklep v názve), sa tak prejaví najneskôr pri nočnom refreshi. Ak je to málo, treba buď `drama.modified` doplniť do DB (kapitola 8), alebo porovnávať kontrolný súčet riadku.
- `external_event` synchronizujte podľa `modified` – má korektný `ON UPDATE`.

### 5.6 Kontrola počtov (hodinovo, nahrádza plnú rekonciliáciu)

`seat.modified` pokryje každú zmenu riadku, **nie však jeho zmazanie**. Keďže `seat` má FK na `plan` s `ON DELETE CASCADE`, zrušenie predstavenia zmaže miesta ticho. Preto beží ľahká kontrola nad aktívnymi termínmi:

```sql
SELECT s.id_plan,
       COUNT(*)                                                         AS seats,
       SUM(s.id_seat_status IN (6,7,9,13,15,17,18,19,21,23,24,27,28))   AS sold,      -- ticket = 1
       SUM(s.id_seat_status IN (5,14,26))                               AS abo,       -- permanentky, ticket = 0
       SUM(s.id_seat_status = 11)                                       AS reserved,
       SUM(s.id_seat_status = 2)                                        AS blocked,   -- nie je predaj
       SUM(s.id_seat_status = 1)                                        AS free,
       SUM(s.scan > 0)                                                  AS scanned,
       MAX(s.modified)                                                  AS last_modified
  FROM seat s
  JOIN plan p ON p.id_plan = s.id_plan
 WHERE p.datum BETWEEN DATE_SUB(NOW(), INTERVAL 7 DAY) AND DATE_ADD(NOW(), INTERVAL 90 DAY)
 GROUP BY s.id_plan;
```

- Cieľ porovná všetky počty so svojou kópiou a **plný výpis miest sťahuje iba pre predstavenia, kde sa čísla nezhodujú**:
  ```sql
  SELECT s.id_seat, s.id_seat_status, s.id_seat_note, s.barcode, s.price, s.scan, s.modified
    FROM seat s WHERE s.id_plan = :idPlan ORDER BY s.id_seat;
  ```
- **Blokované miesta (stav 2) sa rátajú samostatne.** Nie sú predaj ani voľná kapacita; keby sa zliali s voľnými, zmena kapacity sály by vyzerala ako výpadok dát. To isté platí pre permanentky (stavy 5, 14, 26), ktoré majú `ticket = 0`.
- Predstavenie, ktoré v zdroji zmizlo, ale v cieli existuje, sa označí ako zrušené aj so svojimi vstupenkami.
- Kontrola je agregácia nad indexom `id_plan` a pri desiatkach aktívnych termínov je lacná. Pri stovkách ju deľ po skupinách predstavení.
- Plná rekonciliácia všetkých miest (pôvodný denný návrh) už nie je potrebná; ako poistka stačí raz týždenne.

### 5.7 Čo `seat.modified` nezachytí
1. **Zmazané riadky** – kaskáda pri zrušení predstavenia; či maže riadky aj editor sály, alebo miesta len skrýva cez `theater_seat.deleted`, je **neoverené**. Rieši 5.6.
2. **Dôvod zmeny** – z riadku sa nedá odlíšiť storno od refundu či zmeny ceny. Rieši kanál C.
3. **Zmeny v nadväzných tabuľkách bez časovej značky** – `person`, `drama`, `promoter`, `price`. Riešia denné plné refreshe (5.5).
4. **UPDATE s rovnakými hodnotami** značku neposunie; to je v poriadku.

### 5.8 Frekvencie a dávkovanie
| Kanál | Kurzor | Frekvencia | Dávka |
|---|---|---|---|
| A – vstupenky | `seat.modified` + `id_seat`, prekryv 5 min | 1–2 min | 5 000 riadkov |
| B – hlavičky objednávok | `seat_note.id_seat_note`, prekryv 500 | 1–5 min | 1 000 riadkov |
| C – storná a refundy | `storno_seat_log.id_storno_seat_log`, `seat_history.id_seat_history`, `seat_note_refund.id_seat_note_refund` | 5 min | 1 000 riadkov |
| D – kontrola vstupu | `seat_scan.id_seat_scan` | 1 min počas podujatí | 5 000 riadkov |
| E – podujatia | `COALESCE(plan.modified, plan.created)` | 15 min | 1 000 riadkov |
| Číselníky bez časovej značky | – | denne plný refresh | – |
| Kontrola počtov | – | hodinovo pre aktívne termíny | agregácia po predstaveniach |

### 5.9 Technické zásady
- **Idempotencia:** všetko zapisujte ako upsert podľa prirodzeného kľúča (`id_seat`, `id_seat_note`, `id_storno_seat_log`, `id_seat_scan`, `id_plan`). Každá dávka musí byť opakovateľná bez následkov.
- **Kódovanie (overené na dev aj prod RDS):** `seat` a `seat_scan` sú `cp1250`, `storno_seat_log` je `utf8mb4`; spojenie beží cez `SET NAMES utf8`. Pripájajte sa s explicitne nastaveným charsetom a diakritiku overte na vzorke z oboch skupín. Pozor na znaky mimo `cp1250` (emoji, neštandardné apostrofy): v `utf8mb4` tabuľkách sa uložia, v starých nie, takže rovnaký text môže mať v dvoch tabuľkách rôznu podobu. Normalizujte až v cieli, nikdy nie spätným zápisom do zdroja.
- **Záťaž:** čítajte z repliky, nie z primárnej DB. Kanál A využíva index `modified`, kanály B–D primárne kľúče. Pri `seat` overte ešte indexy na `id_seat_note` a `id_plan` (**neoverené**) – používa ich kontrola počtov a dotiahnutie objednávky.
- **Žiadne `OFFSET`** – iba kurzor podľa kľúča.
- **Osobné údaje:** `person`, `invoice` a `seat_note.ip_address` obsahujú osobné údaje. Do skladu prenášajte len to, čo je naozaj potrebné, a e-maily a telefóny držte oddelene.
- **Mazanie:** zdroj používa tvrdé mazanie bez tombstonov a `seat → plan` má `ON DELETE CASCADE`. Rozdiel odhalí len kontrola počtov (5.6).

---

## 6. Čo cieľový systém dostane

```
Event        ← plan (+ drama, hall_desc, promoter, subdomain, price_category)
Order        ← seat_note (+ invoice, person, order_note, mt_payments.basket.ts)
Ticket       ← seat (kľúč id_seat + id_seat_note; stav, cena, barcode)
TicketEvent  ← seat_history + storno_seat_log + seat_scan + seat_note_refund
Payment      ← mt_payments.bank_statement (viď docs/spec-parovanie-vypisov.md)
```

`TicketEvent` je append-only prúd udalostí: `sold`, `reserved`, `cancelled`, `refunded`, `scanned`, `unscanned`, `price_changed`.

Dve pravidlá modelu, ktoré vyplývajú zo zdroja:
- **`Ticket` môže existovať bez `Order`** – týka sa 36,7 % predaja, preto je väzba nepovinná.
- **`Ticket` je miesto v predstavení, nie predaj.** To isté `id_seat` môže byť postupne predané, stornované a predané znovu; históriu drží `TicketEvent`, nie nový riadok.

### 6.1 Vstupenky bez objednávky – ako sa odvodí „objednávka“

Pre 36,7 % predaja (pokladňa, externý predaj, voľné vstupenky, predaj rýchlej rezervácie) hlavička `seat_note` neexistuje a `invoice` tiež nie. `Order` sa preto odvodzuje **výlučne zo `seat`**:

| Zdroj v `seat` | Význam v odvodenej objednávke |
|---|---|
| `id_person` | zákazník, ak je vyplnený; pri pokladničnom predaji býva NULL |
| `id_sys_user` | **predajca** – pokladník, admin alebo partnerské konto, teda kto predaj urobil |
| `changed` | čas predaja; pri týchto predajoch je to jediný čas, ktorý k predaju existuje |
| `id_payment` | platobná metóda (hotovosť, karta na termináli) |
| `id_reservation` | rezervácia, z ktorej predaj vznikol (typicky stav 21 Predaj rýchlej rezervácie) |
| `id_plan` | predstavenie – prirodzená hranica zoskupenia |
| `id_invoice` | pri týchto predajoch je vždy NULL |

**Zoskupenie miest do jednej objednávky:**
```
synthetic_order_key = hash(id_plan, id_sys_user, COALESCE(id_person, 0), changed zaokrúhlený na minútu)
```

Pravidlá:
- **Kľúč sa počíta iba raz, pri prvom videní vstupenky**, a väzba `id_seat → synthetic_order` sa uloží v cieli. Nikdy sa neprepočítava: `changed` sa môže neskôr posunúť a odvodená objednávka by sa rozpadla na dve.
- Zaokrúhlenie na minútu je heuristika pre „jeden nákup pri kase“. Ak sú pokladničné nákupy pomalšie, povoľte okno 2–5 minút a strop počtu miest na jednu odvodenú objednávku.
- Odvodenú objednávku označte príznakom `source = 'derived'`, skutočnú `source = 'seat_note'`. V reportoch sa nesmú miešať – odvodená nemá číslo objednávky ani variabilný symbol.
- **Nepárujte ich na platby.** Bez `seat_note.id_basket` neexistuje VS ani väzba na `mt_payments.bank_statement`; tržba z pokladne prichádza do banky ako súhrnný vklad. Párovanie platieb popisuje `docs/spec-parovanie-vypisov.md`.
- Pri stave 21 použite `id_reservation` na spojenie s pôvodnou rezerváciou, ak ju cieľ eviduje.

---

## 7. Kontrolné scenáre

| # | Scenár | Očakávaný výsledok |
|---|---|---|
| T1 | Online predaj 2 vstupeniek | do 2 min prinesie kanál A 2 vstupenky v stave „predaná“ (posunuté `seat.modified`); kanál B doplní `Order`, faktúru a zákazníka, `Order.paid_at` z `invoice.paid` |
| T2 | Rezervácia prevodom, neskôr zaplatená | vstupenky najprv v stave 11 a `Order` bez `paid_at`; po spárovaní platby sa `seat.modified` posunie a kanál A prinesie stav „predaná“ |
| T3 | Storno cez superadmin | kanál A prinesie miesto v stave 1 s novým čiarovým kódom; kanál C prinesie `storno_seat_log` (čas udalosti = `created`) aj riadok zo `seat_history` |
| T4 | Storno cez admin organizátora | to isté, len bez riadku v `seat_history`; `storno_seat_log` ho musí zachytiť – tento scenár overuje práve tú cestu |
| T5 | Kontrola vstupenky na bráne | do 1 min prinesie kanál D riadok podľa `id_seat_scan` s `scan_time` a `id_gate`; `seat.scan` narastie a príde kanálom A |
| T6 | Offline sken nahraný o hodinu neskôr | riadok dostane nové `id_seat_scan`, takže ho kurzor zachytí bez časového prekryvu; udalosť sa uloží so **skutočným** `scan_time` a stav sa počíta v poradí podľa `scan_time`, nie podľa ID |
| T7 | Predaj na pokladni (mimo `FinalizeOMSale`) | vstupenka príde kanálom A aj bez `id_seat_note`; cieľ ju prijme ako vstupenku bez objednávky a nespadne |
| T8 | Opakovaný beh každej dávky a reštart s posunutým kurzorom dozadu | žiadne duplicity (upsert podľa `id_seat`, `id_seat_note`, `id_storno_seat_log`, `id_seat_scan`) |
| T9 | Preloženie termínu a premenovanie podujatia | termín sa prejaví do 15 min z `plan.modified`; premenovanie v `drama` až pri nočnom refreshi – potvrdenie známeho obmedzenia |
| T10 | Zrušenie predstavenia (zmazanie `plan`) | miesta zmiznú kaskádou a kanál A nič nenahlási; do hodiny to odhalí kontrola počtov a označí podujatie aj jeho vstupenky ako zrušené |

---

## 8. Ak sa smie zmeniť schéma zdroja

Pôvodné body „potvrdiť `seat.modified`“, „pridať PK do `storno_seat_log`“ a „pridať PK do `seat_scan`“ **odpadli** – DDL ich už obsahuje (9.1). Zostáva:

1. **`ALTER TABLE drama ADD modified DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP`** – a rovnako pre `promoter`, `subdomain`, `seat_category`, `price_category`, `price`, `theater_seat`. Lacné, spätne kompatibilné, ruší potrebu nočného refreshu číselníkov.
2. **`seat_note`: pridať `created DEFAULT CURRENT_TIMESTAMP`** – dnes sa čas objednávky musí brať z inej databázy (`mt_payments.basket.ts`).
3. **`seat_scan`: pridať index na (`id_plan`, `barcode`)** – existujúci index je (`id_gate`, `barcode`), takže dohľadávanie skenov predstavenia ide bez indexu.
4. **Zvážiť `ON DELETE RESTRICT` namiesto `CASCADE`** pri `seat → plan`, prípadne tombstone tabuľku. Dnes zrušenie predstavenia nenávratne zmaže históriu predaja. Je to skôr archívne a účtovné riziko než problém syncu, ale patrí pred prevádzku.
5. **Outbox tabuľka plnená triggermi** (`sync_outbox(id, entity, entity_id, op, created)`) – najčistejšie riešenie, ale zasahuje do zápisovej cesty predaja; nasadzujte až po záťažovom teste. Pri dostupnom `seat.modified` je to už len „nice to have“.

Zmeny 1–3 sú aditívne a existujúci kód ich neuvidí. Každú aplikujte najprv na dev, potom UAT.

---

## 9. Neoverené – čo doplniť

### 9.1 Čo zaniklo overením DDL (dev aj prod RDS, 16. 9. 2026)
| Pôvodne neoverené | Výsledok | Dôsledok pre návrh |
|---|---|---|
| Či má `seat.modified` `ON UPDATE CURRENT_TIMESTAMP` | **Áno**, `NOT NULL DEFAULT current_timestamp()`, plus index `modified` | z doplnkového kanála A2 sa stal hlavný kanál A (5.1) |
| Či má `storno_seat_log` PK a časový stĺpec | **Áno**, `id_storno_seat_log` (bigint AI) + `created` | kurzor podľa ID; `created` je čas storna |
| Či má `seat_scan` PK | **Áno**, `id_seat_scan` (int AI) | kurzor podľa ID namiesto `scan_time`, bez prekryvu |
| Aký index má `seat_scan` | (`id_gate`, `barcode`), **nie** (`id_plan`, `barcode`) | párovanie skenov patrí do cieľa, nie do zdrojového dotazu |
| Či sa riadky `seat` mažú pri zrušení predstavenia | **Áno**, FK na `plan` s `ON DELETE CASCADE` | rekonciliácia zúžená na hodinovú kontrolu počtov (5.6) |
| Kódovanie tabuliek | `seat` a `seat_scan` `cp1250`, `storno_seat_log` `utf8mb4` | zapísané v 5.9 |
| Či pokladňa, admin a JSON-RPC vytvárajú `seat_note` | **Nie.** Hlavička vzniká pri online predaji vždy, pri pokladničnom len v 29 % prípadov, pri externom predaji, voľných vstupenkách a predaji rýchlej rezervácie nikdy. Za 30 dní 2 246 zo 6 124 predaných vstupeniek (36,7 %) hlavičku nemá. | kanál B iba obohacuje; objednávka sa inak odvodzuje zo `seat` (6.1) |
| Či sa stavy ABO (5, 14, 26) v dátach vyskytujú | **Za 90 dní ani raz.** Vo filtri napriek tomu zostávajú, lebo `FinalizeOMSale` nastavuje stav 26 pri `plan.abo_mask = 1`. | uzavreté |
| Ako má vyzerať filter syncu | `ticket = 1` nestačí – stav 26 má `ticket = 0` a rezervácie (11, 20) treba sledovať tiež. Filter je **explicitný zoznam stavov** (3.1). | uzavreté |
| Či majú riadky v stave 2 hlavičku objednávky | **Áno, 44 %** (8 305 z 18 774 za 90 dní), žiadny nemá cenu | klasifikovať sa smie len podľa stavu, nikdy podľa `id_seat_note` (3.1) |

DDL bolo overené na **dev aj produkčnej RDS a je identické** (zhodné hashe pre `seat`, `storno_seat_log`, `seat_scan`, `seat_note`, `plan`).

### 9.2 Stále neoverené
| Neoverené | Ako overiť |
|---|---|
| Indexy na `seat.id_seat_note` a `seat.id_plan` | `SHOW CREATE TABLE seat` (pri overovaní DDL sa nesledovali) |
| Či sa pri predaji zapisuje do `seat_history` a aký je význam `operation_type` (0, 1, 3, 4) | telo `UpdateSeatRC` (`SHOW CREATE PROCEDURE`), `SELECT operation_type, COUNT(*) FROM seat_history GROUP BY 1` |
| **Pravdepodobná chyba v aplikácii:** `app/models/Turnstile/Triton.php:657` nastavuje pri zrušení rezervácie z turniketu konštantu `SEAT_STORNO = 15`, ktorá je v číselníku „Externý predaj“ s `ticket = 1`, nie voľné miesto (stav 1). Je to jediné použitie tejto konštanty v projekte. Dáta to potvrdzujú: všetkých 1 343 riadkov v stave 15 za 90 dní má `price = 0` a žiadny `id_seat_note`, takže miesta zostávajú mimo predaja aj mimo ponuky a v reportoch sa tvária ako externý predaj. | potvrdiť s prevádzkou a opraviť na stav 1 (samostatná oprava, mimo tejto špecifikácie); do opravy prenášať v syncu s `suspicious = true` (3.1) |
| Prečo má 29 % pokladničného predaja `seat_note` a zvyšok nie – ide o dve rôzne predajné cesty v admine? | porovnať `id_sys_user`, `id_payment` a `id_invoice` oboch skupín pri stave 6; telá predajných procedúr admina |
| Či `drama`, `promoter`, `subdomain`, `theater_seat` naozaj nemajú žiadnu časovú značku | `SHOW CREATE TABLE` pre každú |
| Význam hodnôt `plan.show_online` (0, 6, 7) a stavu 15 `SEAT_STORNO` | dátová analýza + potvrdenie od prevádzky |
| Či editor sály maže riadky `seat`, alebo miesta len skrýva cez `theater_seat.deleted` | `SHOW TRIGGERS`, telá procedúr editora sály |
| Existencia a obsah fronty `mt_export.export_seat` / `export_group` ako alternatívy k tomuto návrhu | prístup do DB `mt_export`, telá `ExtGetSeatExportList` a `ExtConfirmSeatExportList` |
