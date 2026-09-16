# Funkčná špecifikácia: Párovanie bankových výpisov a platieb

**Účel dokumentu:** podklad pre reimplementáciu modulu v novom systéme (Next.js + Postgres/Supabase).

**Zdroj:** statická analýza MaxiTicket OM4 (`/opt/om`), stav k 15. 9. 2026. Dokument opisuje **existujúce správanie** a pri každej oblasti aj **požadované správanie v novom systéme**. Príklady dát sú anonymizované. Označenie **„neoverené“** znamená, že logika je v uložených procedúrach alebo externom plánovači, ktoré v repozitári nie sú. Pri každom takom mieste je uvedené, kde treba informáciu doplniť.

---

## 0. Terminológia a prehľad

| Pojem | Význam v starom systéme |
|---|---|
| **VS** (variabilný symbol) | 10-miestny identifikátor platby. Pri online objednávke je to číslo košíka (`id_basket`) doplnené nulami zľava, pri rezervácii `seat_note.note`. |
| **SS** (špecifický symbol) | `ID divadla (3 číslice) + "5" + ID predstavenia (6 číslic)`, pri viacerých predstaveniach `999999`. Príklad: `0145000029`. |
| **KS** (konštantný symbol) | Zväčša `0308`, pre párovanie nepodstatný. |
| **Košík / objednávka** | `id_basket` – číslo objednávky. Po zaplatení vznikne hlavička `seat_note` s `id_basket`. |
| **Rezervácia prevodom** | Objednávka s platobnou metódou `OmReserve`: vstupenky sú rezervované (stav 11), zákazník platí prevodom na účet s VS. |
| **machine** | ID session zákazníka. Viaže dočasný košík (`to_sale`) na prehliadač. |
| **PSP / brána** | Platobná brána (Cardpay, GoPay, GP webpay…). Trieda `psp_class` v tabuľke `payment`. |
| **TOUT** | Stav brány „platba ešte nepotvrdená“ (timeout). |
| **Nájomca (global theater)** | Organizácia v multi-tenant DB. `id_global_theater = 0` znamená „vybavené ako náklad“. |

### 0.1 Dve oddelené cesty spracovania
Starý systém má dve nezávislé cesty. **V novom systéme majú zdieľať jednu tabuľku bankových transakcií.**

| | **A – Operatívne párovanie** | **B – Mesačné účtovné párovanie** |
|---|---|---|
| Cieľ | dokončiť zaplatené objednávky a rezervácie, vydať vstupenky | zaúčtovať každý pohyb na účte (typ pohybu), skontrolovať zostatky, export do účtovníctva |
| Spúšťa | cron (`/maintenance/bank-statements`, `/maintenance/payments-process`, `/maintenance/hourly`) | účtovník v admine (`/accounting/*`) |
| Vstup | e-mailové avízo bánk a brán (IMAP), API (Fio, Whitepay, UpDejeuner, GoPay) | mesačný súbor výpisu (MT940, camt.053, CSV, ABO, XLSX) alebo API UpDejeuner |
| Úložisko | `mt_payments.bank_statement` | `mt_payments.acc_bank_summary`, `mt_payments.acc_bank_movement` |
| Kód | `app/models/Maintenance/Payments.php`, `app/models/Superadmin/UnprocessedPayments.php`, `app/models/Maintenance/Reservations.php` | `admin/app/controllers/AccountingController.php`, `admin/app/models/Accounting/*` |

---

## 1. Účel a role

### 1.1 Účel
1. **Zaplatené online objednávky:** zistiť z bankových a PSP avíz, že objednávka bola zaplatená, aj keď návrat z brány do e-shopu zlyhal (zákazník zavrel okno). Potom objednávku dokončiť a poslať vstupenky.
2. **Rezervácie prevodom:** spárovať prevody k rezerváciám, premeniť rezerváciu na predaj a poslať vstupenky. Nezaplatené rezervácie po lehote zrušiť.
3. **Refundy a storná:** evidovať vrátené platby (záporné sumy) a označiť ich ako vybavené.
4. **Účtovníctvo:** každý pohyb na bankovom účte zaradiť do účtovnej kategórie (platba za vstupenky, poplatok, storno, výplata organizátorovi…) a vygenerovať mesačný výpis pre účtovný softvér.

### 1.2 Role
| Rola | Čo robí | Staré oprávnenie |
|---|---|---|
| **Systém (cron)** | sťahuje avízá a API, ukladá transakcie, spúšťa párovanie, dokončuje objednávky a rezervácie, posiela pripomienky a rušenia rezervácií | žiadne (HTTP endpointy bez autentifikácie – **neprenášať**, pozri 8) |
| **Support / superadmin** | rieši nespracované platby: vytvorí vstupenky z rezervácie, zruší rezerváciu, zmení VS, označí platbu ako náklad | `ACTIVE_WEB_SUPERADMIN` (`/superadmin/uprocessed-payments`) |
| **Účtovník (ultraadmin)** | importuje mesačné výpisy, klasifikuje pohyby, spúšťa kontroly a export | superadmin + právo `Účtovanie / výpisy`, `/ párovanie`, `/ report`, `/ kontroly`; menu viditeľné len ultraadminovi |
| **Operátor refundácií** | spracuje žiadosti o vrátenie, pripraví dávky platieb | ultraadmin (`/ultraadmin/refund-request`) |
| **Finance (výplaty organizátorom)** | pripraví a exportuje hromadné platby organizátorom | `Platby organizátorom` (`/promoter-payment/list`) |

### 1.3 Vstupy (súhrn, detail v kapitole 4)
| Zdroj | Spôsob | Formát | Cesta |
|---|---|---|---|
| ČSOB (Info 24 avízo) | IMAP | text/plain (base64, CP1250) | A |
| ČSOB mesačný výpis | upload | camt.053 XML | B |
| ČSOB GP webpay | IMAP / upload | HTML e-mail / XLSX, CSV z portálu | A / B |
| Tatra banka (b-mail, CardPay, TatraPay) | IMAP / upload | text / PGP-šifrovaný CSV (`\|`) / camt.053 XML | A / B |
| SLSP SporoPay | IMAP / upload | HTML, ZIP (7z) s TXT alebo camt.053 XML, CSV / MT940 TXT | A / B |
| VÚB e-platby | IMAP / upload | text / ABO (GPC) | A / B |
| VÚB e-card | IMAP | text šablóna „Merchant Email Template v.1.0.“ | A |
| Fio banka | REST API / upload | JSON / CSV (`;`) | A / B |
| GoPay (SK, CZ) | REST API + IMAP / upload | JSON / quoted-printable text / CSV | A / B |
| Comgate | upload | CSV (`;`) | B |
| Whitepay (krypto) | REST API | JSON | A |
| UpDejeuner (stravné poukážky) | REST API | JSON | A / B |
| Viamo | IMAP | JSON príloha | A (brána vypnutá) |
| Slovenská pošta (ePodací hárok) | IMAP | e-mail | nesúvisí s platbami – do nového modulu nepatrí |

### 1.4 Výstupy
- Záznam transakcie (`bank_statement`, resp. `acc_bank_movement`) s väzbou na objednávku.
- **Dokončená objednávka:**
  - vstupenky v stave „predané“ (23, pri permanentkách 26),
  - hlavička `seat_note.id_basket`,
  - `invoice.paid`,
  - e-mail so vstupenkami (PDF alebo odkaz).
- Zrušená rezervácia (`CancelOMReservation`) a e-maily „pripomienka“ a „zrušenie“.
- Upozornenia: hodinový e-mail „Hourly maintenance / …“, SMS „Unprocessed payments […]“.
- **Účtovné výstupy:**
  - klasifikácia pohybov,
  - mesačný export camt.053 XML,
  - kontrolné zostavy (XLSX),
  - matica „Celkový report“,
  - bilancie do Google Sheets.
- Podklady refundov: SEPA pain.001 XML, CSV pre Cardpay/ČSOB, ABO pre Fio.

---

## 2. Dátový model

Typy a kľúče tabuliek `mt_payments.bank_account`, `bank_statement`, `cardpay_statement`, `acc_bank_summary`, `acc_bank_movement`, `acc_movement_type`, `basket` a `basket_recovery` sú overené z dumpu štruktúry `docs/tables-mt-payments.sql` (dump z dev DB, MariaDB 11.4). Všetky tieto tabuľky sú v `cp1250`. Tabuľky predaja v DB nájomcu (`seat`, `seat_note`, `invoice`, `to_sale`, …) sú rekonštruované z SQL v PHP a v uložených procedúrach, ich typy sú neoverené.

**Doplniť:** `SHOW CREATE TABLE` pre tabuľky predaja v DB nájomcu (`bt_tickets`): `seat`, `seat_note`, `invoice`, `payment`, `to_sale`, `to_sale_recovery`, `basket_serialization`, `reservation`, `online_payment`.

### 2.1 Tabuľky starého systému

#### `mt_payments.bank_account` – bankové a pseudo účty
| Stĺpec | Typ (overený) | Význam |
|---|---|---|
| `id_bank_account` | smallint unsigned PK, auto_increment | napr. 13 a 53 = Cardpay, 153 = Cardpay CZK, 95 = UpDejeuner, 96 = GoPay (EUR), 117 = GoPay (CZK) |
| `name` | varchar(20) | napr. `MAXITICKET.CARDPAY`, `MAXITICKET.CSOBGPWEBPAY` (pseudo účty brán sa identifikujú textom namiesto IBAN) |
| `currency` | char(3) | |
| `prefix` | int(6) unsigned | BBAN – predčíslie |
| `account` | bigint(10) unsigned | BBAN – číslo účtu (bez núl zľava) |
| `bank_code` | smallint unsigned | BBAN – kód banky; index (`account`, `bank_code`) |
| `iban` | varchar(34), NULL | |
| `account_iban` | varchar(34) NOT NULL | |
| `psp_class` | varchar(20) | určuje parser mesačného importu (`Comgateczeur`, `Csobgpwebpay`, `Sporopay`, `Tatrapay`, `Csobpay`, `Fiocz`, `Vubeplatby`, `Gopaysk`, `Gopaycz`, `Updejeuner`); `PaymentRecovery` ho odovzdáva do `basket_recovery.psp_class` |
| `visible`, `group`, `order_no` | tinyint | zobrazenie v admine |
| `int_note` | varchar(255) | |

#### `mt_payments.bank_statement` – transakcie z avíz a API (cesta A)
| Stĺpec | Typ (overený) | Význam |
|---|---|---|
| `id_bank_statement` | int unsigned PK, auto_increment | |
| `id_bank_account` | smallint unsigned, FK → `bank_account` | účet, na ktorý platba prišla |
| `message_id_hash` | bigint unsigned | kľúč deduplikácie: `crc32` + `crc32b` z Message-ID e-mailu + poradie platby v e-maile; pri API hash z ID transakcie (`FIOAPI<id>`, `W<id>`, `UpDejeuner<stan>`). **Nie je unikátny** – index (`message_id_hash`, `amount`) je obyčajný, duplicitu kontroluje iba `AddBankStatement` (3.5). |
| `date` | datetime | dátum transakcie |
| `created` | datetime | **nie je čas zápisu**, ale hodnota z parsera: pri e-mailoch čas odoslania e-mailu, pri Fio dátum transakcie + aktuálny čas, pri Whitepay a UpDejeuner čas vytvorenia u brány, pri GoPay REST „teraz“. Rozhoduje o tom, či `PaymentRecovery` transakciu vôbec spracuje (okno 1 hodina, 3.2). Index (`created`, `tickets`). |
| `amount` | decimal(8,2) NOT NULL | záporná = debet / refund / chargeback; max. 999 999,99 |
| `vs` | bigint(10) **signed** | ukladá sa ako číslo – **nuly zľava sa strácajú** (`0015501234` → `15501234`) |
| `ss` | bigint(10) unsigned | číslo, nuly zľava sa strácajú |
| `ks` | mediumint unsigned | číslo, nuly zľava sa strácajú |
| `cust_prefix` | int(6) unsigned | protiúčet – predčíslie |
| `cust_account` | bigint(10) unsigned | protiúčet – číslo |
| `cust_bank_code` | smallint unsigned | protiúčet – kód banky |
| `cust_iban` | varchar(34) | protiúčet – IBAN |
| `id_order` | bigint unsigned | ID objednávky u brány (predvolene = VS); nečíselná hodnota sa nedá uložiť |
| `transaction` | tinytext (max. 255 bajtov) | ID transakcie u banky alebo brány; `GetUnprocessedPayments` podľa neho rozpoznáva poplatky |
| `description` | tinytext (max. 255 bajtov, dlhší text sa oreže) | popis, správa pre príjemcu; **obsahuje aj čísla kariet a osobné údaje** |
| `id_machine` | int unsigned | `AddBankStatement` ho nastaví na `to_sale.machine` nájdeného košíka, inak NULL (PHP síce posiela VS, ale SP ho použije ako číslo košíka) |
| `id_basket` | int unsigned, index | **spárovaná objednávka**: VS z výpisu, prípadne nové číslo košíka, do ktorého sa miesta presunuli (3.2); ručne meniteľné (Zmeniť VS) |
| `tickets` | tinyint unsigned, default 0 | stav automatického dokončenia: **0** = nič (košík nenájdený alebo už predaný), **1** = košík nájdený, čaká na `PaymentRecovery`, **2** = spracované (zapísané do `basket_recovery` alebo preskočené pre sumu ≤ 0 / chýbajúci košík) |
| `id_global_theater` | smallint unsigned, index | nájomca, u ktorého sa našiel košík; **NULL = nespárované** (zoznam pre support); `0` = vybavené ako náklad (ručne alebo automaticky podľa textu, 2.4 `GetUnprocessedPayments`). Pri rezervácii (stav sedadla 11) ho `AddBankStatement` zámerne nechá NULL. |
| `other_payments` | tinyint unsigned, default 0 | komentár v DB: „0 - no, 1 - yes“; kto ho zapisuje, je neoverené |
| `processed` | tinyint unsigned, default 0 | dodané SP ho nezapisujú – neoverené |
| `id_seat_note` | int unsigned | dodané SP ho nezapisujú, PHP tiež nie – neoverené |
| `payme` | tinyint unsigned NOT NULL, default 0 | dodané SP ho nezapisujú – neoverené (pravdepodobne cron `payMe` v `MaintenanceController`) |
| `refunded` | tinyint unsigned NOT NULL, default 0 | dodané SP ho nezapisujú – neoverené |

Stĺpce `processed`, `id_seat_note`, `payme`, `refunded` a `other_payments` treba doplniť z tela `SetUnprocessedPayment` a z procedúr volaných cronom `payMe` (`SHOW CREATE PROCEDURE`) a z `SHOW TRIGGERS FROM mt_payments`.

**Nespárovaná položka** = riadok v `bank_statement` s `id_global_theater IS NULL` (overené v tele `GetUnprocessedPayments`).

#### `mt_payments.cardpay_statement` – denný výpis Cardpay
`id_cardpay_statement` (mediumint unsigned PK), `id_basket` (int unsigned, index), `id_bank_account` (smallint unsigned, bez FK), `date_processing` (date), `date_trans` (date – bez času), `amount` (decimal(7,2), max. 99 999,99), `currency` (char(3), default `EUR`), `auth_key` (varchar(20)), `row` (varchar(255) – celý riadok výpisu, dlhší sa oreže), `created`, `modified`. Plní ho `CALL AddCardpayStatement`. **Tabuľka nemá unikátny kľúč** – opakované spracovanie toho istého denného výpisu vytvorí duplicitné riadky (či duplicitu kontroluje `AddCardpayStatement`, je neoverené – telo SP nebolo dodané).

#### `mt_payments.acc_bank_summary` – mesačný súhrn výpisu (cesta B)
`id_acc_bank_summary` (mediumint unsigned PK), `id_bank_account` (smallint unsigned, FK → `bank_account`), `period_from`, `period_to` (date NOT NULL), `first_balance`, `last_balance`, `credit_sum`, `debit_sum`, `charges_sum` (decimal(13,2), default 0), `credit_cnt`, `debit_cnt` (smallint unsigned – max. 65 535 pohybov za obdobie), `created`, `modified`. **Unikátny kľúč (`id_bank_account`, `period_from`, `period_to`)** – upsert podľa účtu a obdobia; iné obdobie toho istého mesiaca (napr. výpis bez `FrToDt`) vytvorí ďalší súhrn.

#### `mt_payments.acc_bank_movement` – pohyb mesačného výpisu (cesta B)
| Stĺpec | Význam |
|---|---|
| `id_acc_bank_movement` (int unsigned PK), `id_acc_bank_summary` (mediumint unsigned, NULL, bez FK), `id_bank_account` (smallint unsigned NOT NULL, FK → `bank_account`) | |
| `id_movement` (bigint unsigned NOT NULL) | deterministický hash riadku výpisu (napr. `crc32` z `COMGATECZEUR\|id\|vs\|dátum\|suma`); pri Fio a GoPay priamo ID pohybu. **Unikátny kľúč (`id_bank_account`, `id_movement`)** – overené. |
| `date` (datetime), `date_acc` (date) | dátum transakcie, dátum zaúčtovania; index na `date` |
| `amount` (decimal(13,2) NOT NULL, index), `currency` (varchar(3)) | |
| `vs`, `ss` (bigint(10) unsigned), `ks` (mediumint unsigned), `prefix` (int(6) unsigned), `account` (bigint(10) unsigned), `bank_code` (smallint unsigned), `iban` (varchar(34)), `note` (tinytext, max. 255 bajtov) | z výpisu; symboly ako čísla – nuly zľava sa strácajú; index na `vs` |
| `id_acc_movement_type` (tinyint unsigned, NULL, FK → `acc_movement_type`) | účtovná kategória (2.3). **Nepriradené = NULL**; hodnotu 0 cudzí kľúč pripustí, len ak v číselníku existuje riadok s ID 0 (obsah číselníka neoverený). |
| `vs_alt` (bigint(10) unsigned, index) | ručne opravený VS |
| `amount_delivery` (decimal(13,2) NOT NULL, default 0) | z toho poštovné (komentár v DB: „vstup.postou (3eur)“) |
| `amount_expenses` (decimal(13,2) NOT NULL, default 0) | z toho manipulačné poplatky (komentár: „manipulacne“) |
| `over_card_system` (tinyint(1) NOT NULL, default 0) | 1 = platba kartou (Cardpay, e-card) |
| `manual_change` (tinyint(1) NOT NULL, default 0) | 1 = ručne upravené; pri reimporte sa ručné polia **neprepisujú** |
| `created`, `modified` (datetime, automaticky) | |

#### `mt_payments.basket` – globálny generátor čísiel košíkov
`id_basket` (int unsigned PK, auto_increment), `ts` (timestamp), `id_global_theater` (smallint unsigned). Tabuľka je spoločná pre všetkých nájomcov. `AddBankStatement` hľadá VS ako číslo košíka postupne u všetkých nájomcov, čo predpokladá, že čísla košíkov (= VS online objednávok) sú jedinečné naprieč nájomcami. Ktorá procedúra čísla z tabuľky prideľuje, je neoverené (pravdepodobne `CheckOMSale`). V dumpe z dev DB je `AUTO_INCREMENT = 16 114 953` – pozor na limit parametra `FinalizeOMSale` (2.4).

#### `mt_payments.basket_recovery` – fronta košíkov na dokončenie z výpisu
| Stĺpec | Typ (overený) | Význam |
|---|---|---|
| `id_basket_recovery` | **smallint unsigned** PK, auto_increment | max. 65 535; v dumpe `AUTO_INCREMENT = 32 284` – pri tomto tempe hrozí pretečenie |
| `id_basket_serialization` | bigint unsigned NOT NULL | `basket_serialization.id` v DB nájomcu |
| `created` | datetime | čas zápisu (`PaymentRecovery`) |
| `id_global_theater` | smallint unsigned NOT NULL | nájomca |
| `amount` | decimal(8,2) unsigned | zaplatená suma z výpisu |
| `id_machine`, `id_basket` | int unsigned | z `bank_statement` |
| `modified` | datetime | pravdepodobne čas spracovania v `payments-process` (neoverené – telo `GetPaymentRecoveryList` nebolo dodané) |
| `psp_class` | varchar(20) | `bank_account.psp_class` účtu, na ktorý platba prišla |

Bez unikátneho kľúča; index iba na `created`.

#### Tabuľky predaja, s ktorými sa páruje (DB nájomcu)
| Tabuľka | Kľúčové stĺpce pre párovanie |
|---|---|
| `seat_note` (hlavička objednávky) | `id_seat_note`, `id_basket` (NULL = nezaplatená rezervácia), `note` (VS rezervácie, niekedy s `#` alebo 10-miestny s nulami) |
| `seat` (vstupenka / miesto) | `id_seat`, `id_seat_note`, `id_plan`, `id_seat_status`, `price`, `id_expenses` (poplatok za miesto), `id_invoice`, `id_person`, `id_reservation`, `id_payment`, `barcode`, `changed` |
| `seat_history` | kópia `seat` pri zmenách + `id_storno_user`, `operation_type` |
| `storno_seat_log` | snímka vstupenky pred stornom |
| `invoice` | `id_invoice`, `id_payment`, `id_expenses` (doručenie), `price`, `paid` (datetime, NULL = neuhradené), `order_number`, `reservation_reminder`, `reservation_cancel` (datetime), `email`, adresa, `tracking_number` |
| `payment` (platobná metóda) | `id_payment`, `psp_class`, `name`, `id_expenses` (percentuálny poplatok za metódu), `enabled` (význam neoverený) |
| `expenses` | `id_expenses`, `name`, `value`, `eph` (1 = doručenie poštou) |
| `to_sale` (dočasný košík) | `machine`, `id_seat`, `id_plan`, `id_basket` (NULL = upraviteľný, vyplnený = beží platba), `id_payment` |
| `basket_serialization` | `id` (= číslo košíka pre bránu), `machine`, `data` (serializovaný košík), `created` – z neho sa objednávka dokončí, ak platba príde z výpisu |
| `seat_note_refund` | `id_seat_note_refund`, `id_seat_note`, `id_plan`, `date_request`, `days_to_refund`, `processed`, `date_refund` (NULL = čaká), `date_refund_email`, `iban` |
| `seat_refund` | `id_seat`, `id_seat_note_refund`, `id_seat_note`, `price`, `processed`, `id_payment`, `id_person` |
| `plan_refund_customer_choice` | voľba zákazníka pri zrušenom podujatí: `status` 0 nová / 1 v riešení / 2 vybavené, `price`, `iban` |
| `gopay_payment` | `id_payment` (GoPay), `vs` (= `id_basket`), `status` (PAID, REFUNDED, …) |
| `promoter_report` | protokol organizátorovi: `invoice_no` (6 číslic), `amount`, `date_from/to` |
| `promoter_report_payment` | výplata organizátorovi: `type` (C príprava / A schválené), `vs`, `ss`, `iban`, `amount`, `date_paid`, `set_as_paid_manual` |
| `basket_psp` | `id_basket`, `token` – iba brána Saferpay, s párovaním nesúvisí |

### 2.2 Stavy

**Vstupenka (`seat.id_seat_status`)** – iba hodnoty relevantné pre párovanie. Názvy sú overené z číselníka `seat_status` (`docs/ciselniky.txt`, celkom 28 hodnôt), správanie z `FinalizeOMSale` a `AddBankStatement`:
| Hodnota | Názov v číselníku | Význam pre párovanie |
|---|---|---|
| 1 | Voľné sedadlo | voľné (aj po storne); `FinalizeOMSale` pri expirovanom košíku znovu obsadí iba miesta v tomto stave |
| 2 | Blokované sedadlo | `FinalizeOMSale` ho nastaví rodičovskému sedadlu permanentky v stave 27 (cena 0) a sedadlám skupiny predstavení |
| 6 | Predaj | predaj na pokladni, nie online |
| 11 | Rezervácia | čaká na platbu prevodom; `FinalizeOMSale` ho nastaví pri `PaymentType = 'OmReserve'`; `AddBankStatement` pri ňom nechá platbu nespárovanú (`id_global_theater = NULL`) |
| 23 | Internetový predaj | predané online; faktúra (ak vzniká) dostane `paid = now()` |
| 25 | Internetová rezervácia | v číselníku vypnutý (`enabled = 0`), v párovaní sa nepoužíva |
| 26 | Online ABO | predaná permanentka (`plan.abo_mask = 1`); faktúra dostane `paid = now()` |
| 27 | Online ABO mifare | permanentka na čipovej karte; rodičovské sedadlo (`is_parent = 1`) sa pri dokončení zmení na stav 2 s cenou 0 |

**Objednávka (odvodené, stav explicitne neexistuje):**
```
[košík] --paymentPrecheck--> [čaká na bránu: to_sale.id_basket vyplnené, basket_serialization]
   |--návrat OK / avízo z výpisu--> [DOKONČENÁ: seat_note.id_basket, seat 23/26, e-mail]
   |--zlyhanie/zrušenie--> [košík odomknutý: ClearBasketId]
[rezervácia: seat 11, seat_note.note, invoice.paid NULL]
   |--platba s presnou sumou--> [DOKONČENÁ: invoice.paid, seat 23/26, seat_note.id_basket = note]
   |--2 prac. dni--> [pripomenutá: invoice.reservation_reminder]
   |--ďalšie 2 prac. dni--> [ZRUŠENÁ: CancelOMReservation, invoice.reservation_cancel]
[DOKONČENÁ] --žiadosť o refund--> [seat_note_refund.date_refund NULL] --CancelOMSale--> [stornovaná] --odoslaná platba--> [date_refund]
```

**Transakcia (`bank_statement`, overené z procedúr):**
| Udalosť | `tickets` | `id_global_theater` | Význam |
|---|---|---|---|
| `AddBankStatement`: košík čaká na bránu (`to_sale`) alebo je po expirácii a ešte nepredaný (`to_sale_recovery`) | 1 | nájomca | spárované, čaká na `PaymentRecovery` |
| `AddBankStatement`: košík nájdený, ale už predaný | 0 | nájomca | považuje sa za vybavené; **v zozname nespárovaných sa nezobrazí** (dvojitá platba ostane nepovšimnutá) |
| `AddBankStatement`: rezervácia (stav 11) alebo košík nenájdený u žiadneho nájomcu | 0 | NULL | **nespárované** → zoznam supportu a cesta A2 |
| `PaymentRecovery`: košík zapísaný do `basket_recovery`, alebo suma ≤ 0 / bez košíka | 2 | bez zmeny | spracované |
| `PaymentRecovery`: serializácia košíka nenájdená do 1 hodiny od `created` | ostáva 1 | nájomca | **uviaznuté** – nedokončí sa a nie je ani medzi nespárovanými |
| `GetUnprocessedPayments`: text poplatku / výplaty / pôžičky | bez zmeny | NULL → 0 | automaticky vybavené ako náklad |
| support: `SetUnprocessedPayment` | bez zmeny | nájomca alebo 0 | ručne vybavené |

**Brána (`PSP_STATUS`):**
- `OK` – zaplatené,
- `NOK` / `CANCEL` – zlyhanie,
- `TOUT` – nepotvrdené; objednávka sa dokončí s `PostPayment = 1` a vstupenky sa vydajú **pred prijatím peňazí** – neprenášať.

### 2.3 Účtovné typy pohybov (`acc_movement_type`, `admin/app/models/Accounting/MovementType.php`)
| ID | Názov | ID | Názov |
|---|---|---|---|
| 0 | Nepriradené | 30–38 | skupina výplat/poplatkov organizátorov (31 = Odoslaná platba organizátorovi, 33 = Poplatky organizátorovi, 36 = Manipulačné poplatky) |
| 1 | (agregovaný typ – názov doplniť z DB) | 40, 42, 43 | iba v DB (neoverené) |
| 2 | Poštovné | 44 | Peniaze z platobnej brány (GoPay) |
| 11 | Platba za vstupenky | 46 | Platba inej firme |
| 12 | Platba za vstupenky – zaúčtované v nasledujúcom mesiaci | | |
| 15 | Storno – rovnaký mesiac | | |
| 16 | Storno – iný mesiac | | |
| 20 | Bankové poplatky | | |
| 21 | Poplatky za transakcie | | |

**Doplniť:** obsah číselníka `mt_payments.acc_movement_type` (`SELECT * FROM mt_payments.acc_movement_type`). Dodaný dump obsahuje iba štruktúru: `id_acc_movement_type` tinyint unsigned PK, `name` varchar(60), `created`, `modified`. `AUTO_INCREMENT = 47`, takže najvyššie pridelené ID je najviac 46. Súbor `docs/ciselniky.txt` tento číselník neobsahuje. Názvy 1, 30–38, 40, 42, 43 a existencia ID 0 sú preto naďalej neoverené.

### 2.4 Uložené procedúry
Telá procedúr `AddBankStatement`, `PaymentRecovery`, `GetUnprocessedPayments` a `FinalizeOMSale` sú overené z `docs/sp-payments-current.sql` (detail v 2.4.1–2.4.4). Pri ostatných sú vstupy a výstupy odvodené z volaní v PHP a ich logika je neoverená.

Spoločné vlastnosti overených procedúr:
- nepoužívajú transakciu ani zámky,
- bežia ako `DEFINER root`,
- majú nestriktný `sql_mode` (`ERROR_FOR_DIVISION_BY_ZERO,NO_ENGINE_SUBSTITUTION`), takže hodnota mimo rozsahu parametra sa ticho oreže na maximum typu a text dlhší ako stĺpec sa ticho skráti.

**Doplniť:** `SHOW CREATE PROCEDURE` pre `GetPaymentRecoveryList`, `SetUnprocessedPayment`, `CheckOMSale`, `CancelOMReservation`, `CancelOMSale`, `GetBankAccount`, `AddCardpayStatement`, `GetBankStatementCardpayByTID`, `GetRefundDetail` a pre procedúry volané z `FinalizeOMSale`: `ExpensesToBasket`, `UpdateSeatRC`.

| Procedúra | Vstupy | Výstup / čo PHP očakáva | Čo robí |
|---|---|---|---|
| `AddBankStatement` | `MessageIdHashIN` bigint unsigned, `AmountIN` decimal(8,2), `basketID` int unsigned (PHP sem posiela VS), `IdBankAccountIN` smallint unsigned, `CustPrefixIN` int unsigned, `CustAccountIN` bigint unsigned, `CustBankCodeIN` smallint unsigned, `CustIbanIN` varchar(34), `vsIN`, `ssIN` bigint unsigned, `ksIN` mediumint unsigned, `createdIN` datetime, `descriptionIN` tinytext, `dateIN` datetime, `IdOrderIN` bigint unsigned, `transactionIN` tinytext | `RowAffected` (1 = vložené, 0 = duplicita); PHP výsledok nečíta | **overené:** deduplikácia, vyhľadanie košíka u nájomcov, predĺženie zámku miest, zápis transakcie (2.4.1) |
| `AddCardpayStatement` | `idBankAccount, IdBasket, DateProcessing, DateTrans, Amount, Currency, AuthKey, RowData` | nič | riadok denného výpisu Cardpay |
| `GetBankStatementCardpayByTID` | `tid` | `id_basket, bank_account_iban` | dohľadá pôvodnú platbu pri chargebacku |
| `GetBankAccount` | `account, bank_code, iban` | `id_bank_account` | priradenie účtu podľa BBAN / IBAN / pseudo názvu |
| `PaymentRecovery` | – | nič | **overené:** košíky spárované v `AddBankStatement` zapíše do fronty `mt_payments.basket_recovery` (2.4.2) |
| `GetPaymentRecoveryList` | `IdGlobalTheater` | `id_basket_serialization, id_machine, amount, psp_class` | zaplatené, ale nedokončené online košíky; stĺpce sa zhodujú s `basket_recovery`, takže pravdepodobne číta túto frontu (telo a spôsob označenia spracovaných riadkov neoverené) |
| `GetUnprocessedPayments` | – | `bank_account_name`, `bank_account_currency` + všetky stĺpce `bank_statement` | **overené:** nespárované platby (`id_global_theater IS NULL`); **má vedľajší efekt** – najprv označí poplatky a výplaty ako náklad (2.4.3) |
| `SetUnprocessedPayment` | `id_bank_statement, id_global_theater` | nič | označí platbu ako vybavenú (0 = náklad) |
| `GetBankStatementList` | `IdGlobalTheater` | `amount, created, id_machine, message_id_hash, name, transaction` | prehľad pre SMS kontrolu |
| `GetPayments` | `idBasket` | `cnt, id_bank_account, psp_class, amount_plus, amount_minus, cardpay_amount_minus, description` | všetky platby k objednávke (pri refunde) |
| `CheckOMSale` | `machineID, sysuser, BasketCount, BasketSum, StopMinutes, basketId` | `ReturnCode` (0 OK, 1 platba beží, 2 prázdny košík, 3/5 nesedí počet/suma, 4 stop predaja, 6 prázdny e-mail, 7 chýba basketId, 8 transakcia beží, 9 limit), `IdBasket` | predkontrola pred bránou, uzamkne košík |
| `FinalizeOMSale` | `machineID` int unsigned, `sysuser` smallint unsigned, `IdBasket` **mediumint unsigned (max. 16 777 215)**, `TotalCount` smallint unsigned, `IdPerson` mediumint unsigned, `variableSymbol` varchar(32), `InvoiceCreate`, `ReservationCreate` boolean, `ReservationValidDays` tinyint unsigned, `PaymentType` varchar(32) (= psp_class), `id_delivery_expenses` smallint unsigned, `IdPayment` smallint unsigned, `PostPayment` tinyint unsigned (TOUT → 1), `Referral` varchar(255), `IPAddress` varchar(32) | `RowAffected, variableSymbol, IdReservation, ReservationDate, StatusPayment` | **overené:** obnoví expirovaný košík, vytvorí faktúru, `seat_note`, rezerváciu, predá sedadlá cez `UpdateSeatRC`; `RowAffected = 0` a `StatusPayment = 1` = už dokončené; `RowAffected ≠ TotalCount` = chyba (2.4.4) |
| `ClearBasketId` | `machine` | nič | odomkne košík po zlyhaní platby |
| `CancelOMReservation` | `idSeatNote` | `ReturnCode`: 1 OK, 2 faktúra zaplatená, 3 už zrušená, 4 faktúra neexistuje, 5 miesta iného divadla, 20 nezistená rezervácia, 21 nenájdená | zruší rezerváciu |
| `CancelOMSale` | `'(id_seat,…)', idPayment` | `ReturnCode` (1 OK, 20 no seat…), `IdStornoInvoice`, `ProcessedIdSeatList` | storno predaných vstupeniek pri refunde |
| `GetRefundDetail`, `GetRefundSummaryList_` | zoznam žiadostí / typ | sumy refundu, poplatky, IBAN, údaje z bankovej platby | podklady refundov |
| `GetCanceledEventPayments` | `idPlan` | platby za zrušené podujatie | hromadné refundy |
| `GetTicketOMList`, `GetTicketOMListReservation` | `idBasket` | údaje zákazníka pre e-mail | |

#### 2.4.1 `AddBankStatement` (overené)
1. **Duplicita:** ak už existuje riadok s rovnakým `message_id_hash` **a zároveň** rovnakou `amount`, nič sa nevloží a vráti sa `RowAffected = 0`.
   - Kontrola je `SELECT COUNT(*)` bez zámku a bez unikátneho indexu, takže dva súbežné behy vložia duplicitu.
   - Rovnaký hash s inou sumou sa vloží ako nová transakcia.
2. **Hľadanie košíka:** procedúra prechádza nájomcov z `bt_global.global_theater` s `payment_processing = 1` (poradie nie je definované). V DB každého nájomcu hľadá číslo košíka rovné VS:
   1. **`to_sale.id_basket = VS`** (košík čaká na bránu):
      - zámok miest (`to_sale.datum`) sa predĺži o **30 minút**,
      - `tickets = 1`, `id_machine = to_sale.machine`, nájomca = tento,
      - hľadanie končí.

      **Suma sa neporovnáva** – súčet `final_price` sa načíta, ale nepoužije.
   2. **Inak `to_sale_recovery.id_basket = VS`** (záloha košíka po expirácii). Spočítajú sa položky, z toho položky už predané (sedadlo s rovnakým `id_seat`, `id_person` a cenou = `final_price`) a položky znovu vložené do niektorého `to_sale` (rovnaké miesto, osoba a cena).
      - **Nič nie je predané:**
        - ak sú všetky položky znovu v `to_sale` **a** suma platby = súčet `final_price`, zámok nového košíka sa predĺži o 30 minút a **`id_basket` sa prepíše na číslo nového košíka**;
        - `tickets = 1` sa nastaví v každom prípade, aj pri nezhode sumy.
      - **Aspoň jedna položka je predaná:** `tickets = 0`.
      - V oboch prípadoch je nájomca = tento a hľadanie končí.
   3. **Nenájdené** → pokračuje ďalším nájomcom.
3. Ak je stav sedadla z kroku 2.2 **11 (rezervácia)**, nájomca sa vynuluje. Platba skončí medzi nespárovanými a spracuje ju cesta A2 (3.3). Stav sa berie z neagregovaného stĺpca, teda z ľubovoľného riadku košíka.
4. Vloží riadok do `bank_statement`:
   - `id_machine` = nájdené `machine` alebo NULL,
   - `id_basket` = VS alebo číslo nového košíka,
   - `tickets`,
   - `id_global_theater` = nájomca alebo NULL.

**Dôsledky pre párovanie:**
- VS sa porovnáva priamo s číslom košíka, nie so `seat_note.note`.
- Nedoplatok ani preplatok procedúra nerozpozná.
- Druhá platba k už predanému košíku dostane nájomcu a `tickets = 0`, takže sa medzi nespárovanými nezobrazí.

#### 2.4.2 `PaymentRecovery` (overené)
1. Vyberie riadky `bank_statement` s `tickets = 1` a `created` **v poslednej 1 hodine**. K nim načíta `bank_account.psp_class` a názov DB nájomcu.
2. Ak je suma ≤ 0 alebo chýba košík (`id_basket` NULL alebo 0), nastaví `tickets = 2` a nič ďalšie nerobí.
3. Inak hľadá v DB nájomcu `basket_serialization.id = id_basket` (najnovší záznam):
   - **nájdené:** vloží riadok do `mt_payments.basket_recovery` (serializácia, nájomca, suma, `id_machine`, `id_basket`, `bank_account.psp_class`) a nastaví `tickets = 2`;
   - **nenájdené:** nič nezmení. Ďalší beh to skúsi znova, ale **len kým `created` nie je staršie ako 1 hodina**. Potom riadok ostane natrvalo s `tickets = 1` a nájomcom, objednávka sa nedokončí a platba nie je ani medzi nespárovanými.
4. Riadok bez nájomcu sa preskočí.

**Známe chyby (overené v tele procedúry):**
- **Serializácia iného košíka:** premenná `@_IdBasketSerialization` sa medzi riadkami nenuluje. Ak serializácia aktuálneho košíka neexistuje, `SELECT … INTO` ponechá hodnotu z predchádzajúceho riadku. Do `basket_recovery` sa tak zapíše serializácia iného košíka a transakcia sa označí `tickets = 2`. `payments-process` potom pracuje s nesprávnym košíkom a správny sa nedokončí.
- **Okno 1 hodina** sa počíta z `created` z parsera, nie z času zápisu (2.1):
  - pri Fio je `created` = dátum transakcie + aktuálny čas, takže transakcie zo včerajška sú mimo okna hneď pri zápise;
  - e-mail spracovaný viac ako hodinu po odoslaní (výpadok IMAP alebo cronu) sa tiež nespracuje.

#### 2.4.3 `GetUnprocessedPayments` (overené)
1. **Vedľajší efekt:** riadkom s `id_global_theater IS NULL` nastaví `id_global_theater = 0` (vybavené ako náklad), ak platí niektorá podmienka:
   - `transaction` začína `POS ` a obsahuje `PROVIZIA-` (provízie POS terminálov),
   - `description` začína `Peniaze prijate systemom MaxiTicket`,
   - `description` alebo `transaction` obsahuje `prijate systemom MaxiTicket na zaklade Mandatnej` (výplaty organizátorom),
   - `transaction` je presne `DTPOPLATOK POS` alebo `DTPLATBA POS` (`LIKE` bez zástupných znakov),
   - `description` obsahuje `Zmluva o pozicke`.
2. Vráti `bank_account.name`, `bank_account.currency` a všetky stĺpce `bank_statement`, kde `id_global_theater IS NULL`, bez triedenia a bez limitu.

Každé zobrazenie zoznamu nespracovaných platieb a každý beh `finishReservationsByCron` teda mení dáta.

#### 2.4.4 `FinalizeOMSale` (overené)
Volá ďalšie procedúry `ExpensesToBasket` a `UpdateSeatRC`, ktorých telá neboli dodané.

1. **Príprava košíka** (položky `to_sale` košíka):
   - `datum = now + 1 s`, doplní sa `id_person`,
   - položky v stave 27 s `is_parent = 1` → stav 2 a cena 0,
   - pri `PaymentType = 'OmReserve'` → stav **11**.

   Počet zmenených riadkov = `BasketItemCount`. Potom `CALL ExpensesToBasket(machineID)`.
2. `OmReserve` vždy vynúti `ReservationCreate = TRUE`.
3. **Košík expiroval** (`BasketItemCount = 0` alebo ≠ `TotalCount`):
   1. položkám v `to_sale`, ktoré majú rovnaký `machine` a miesto ako v `to_sale_recovery`, vráti `id_basket`;
   2. ak stále chýbajú, vloží (`INSERT IGNORE`) do `to_sale` položky z `to_sale_recovery`, **ktorých sedadlo je voľné (stav 1)**;
   3. ak stále chýbajú:
      - ak sú všetky sedadlá z `to_sale_recovery` predané tej istej osobe za tú istú cenu → `StatusPayment = TRUE`, `RowAffected = 0` (**„už dokončené“**);
      - inak zapíše `online_payment` (`price = -1.0`, `payment = PaymentType`, `variable_symbol`) a skončí s `RowAffected = 0`, `StatusPayment = FALSE` (miesta medzitým obsadil niekto iný).
4. **Súčty z `to_sale`:**
   - stav sedadla (z ľubovoľného riadku),
   - `FinalPrice = Σ final_price`,
   - `IdPlan` (NULL pri viacerých predstaveniach),
   - zľava, affiliate.
5. **Doručenie:** `handlingFee = expenses.value`. Ak je 0 a nevzniká faktúra alebo rezervácia, `id_expenses` sa nevyplní.
6. **`PostPayment = 1` (TOUT):** vznikne iba záznam v `printer_queue`. Na stave sedadiel ani faktúry to nič nemení, TOUT objednávka sa predá rovnako ako OK.
7. **Faktúra** vznikne, iba ak je `InvoiceCreate`, `ReservationCreate` alebo je vyplnené doručenie:
   - `price = FinalPrice + doručenie + Σ poplatkov položiek`,
   - `order_number = variableSymbol`,
   - pri stave 23/26 `paid = now()` a `reservation = 0`, inak `paid = NULL` a `reservation = 2`,
   - `id_payment = IdPayment`, kontaktné údaje z `person`.

   **Online predaj bez faktúry a doručenia nemá faktúru ani `invoice.paid`.**
8. **`seat_note`:** `note = variableSymbol`; `id_basket = NULL` pri stave 11, inak `IdBasket`; referral, IP, affiliate.
9. **Rezervácia:** `reservation.reservation_date = dnes + ReservationValidDays`. PHP cron rezervácií (3.4) tento dátum nepoužíva, počíta pracovné dni od `seat.changed`.
10. **Predaj:** vytvoria sa osoby pre menné vstupenky, potom `CALL UpdateSeatRC(...)` zapíše sedadlá a vráti `RowAffected`.
11. **Kontrola výsledku:**
    - `RowAffected = 0` → faktúra sa zmaže;
    - `RowAffected ≠ BasketItemCount` → vráti 0, ale **faktúra ani čiastočne predané sedadlá sa nevrátia** (procedúra nepoužíva transakciu).
12. **Pri úspechu** (`RowAffected = TotalCount`):
    - kupón `used_cnt + 1` (premenná `@ExistingVoucher` sa nenuluje, v tom istom DB spojení sa môže započítať kupón z predchádzajúceho volania),
    - permanentky (`reservation` so vstupmi / dňami platnosti), `seat_voucher`, turnikety,
    - sedadlá skupiny predstavení → stav 2,
    - zmazanie `to_sale`.
13. **Výstup:** `RowAffected, variableSymbol, IdReservation, ReservationDate, StatusPayment`.

**Riziká pre párovanie:**
- **Idempotencia je iba heuristika** (krok 3.3). Príklad: objednávka sa dokončila cez callback brány, potom sa stornovala (sedadlá späť v stave 1) a až potom prišla transakcia z výpisu. `AddBankStatement` nenájde predané položky a nastaví `tickets = 1`. Ak `to_sale_recovery` ešte existuje, krok 3.2 sedadlá **predá znovu**.
- **Pretečenie `IdBasket`:** parameter je `MEDIUMINT UNSIGNED` (max. 16 777 215).
  - `mt_payments.basket` má v dumpe z dev DB `AUTO_INCREMENT = 16 114 953`, zostáva teda približne 662 000 čísiel.
  - Väčšie číslo sa pri nestriktnom `sql_mode` ticho oreže na 16 777 215, košík sa nenájde a dokončenie objednávky zlyhá.
  - Platí to, ak sa čísla košíkov prideľujú z tejto tabuľky (neoverené). Produkčnú hodnotu treba bezodkladne overiť (kapitola 10).

---

## 3. Algoritmus párovania

### 3.1 Normalizácia transakcie (spoločné pre všetky zdroje)
1. **Suma:**
   - odstráni sa oddeľovač tisícov (medzera, `.`) a `,` sa nahradí `.`;
   - debet alebo refund je záporná suma;
   - GoPay REST posiela sumu v centoch (÷ 100).
2. **VS / SS:** číslice doplnené nulami zľava na 10 znakov, KS na 4. Starý systém to nerobí jednotne (Viamo, GoPay e-mail, Tatrapay, VÚB e-card a GP webpay nedopĺňajú) – **v novom systéme normalizovať vždy**.
3. **Chýbajúci VS:**
   - ČSOB, VÚB: VS = prvé 8–10-miestne číslo v popise alebo referencii;
   - referencia v tvare `/VS0015501234/SS0145000029/KS0308` sa rozloží regexom.
4. **SS `0000000000`:** ak existuje rezervácia `seat_note.note LIKE VS`, SS sa doplní na `buildTheaterSpecificSymbol(0)`.
5. **Mena:** neukladá sa, určuje ju bankový účet. **V novom systéme ukladať menu vždy.**
6. **Neplatný záznam:** ak parser nevyplní povinné pole (hodnota `n/a`) alebo nenájde účet, transakcia sa neuloží a e-mail ostane neprečítaný. Spracúva sa donekonečna bez upozornenia – **neprenášať** (nový systém: stav `parse_error` + upozornenie).

Príklad normalizovanej transakcie:
```json
{
  "source": "csob_avizo",
  "external_id": "b3f1…(hash Message-ID)#1",
  "bank_account": "SK00 7500 0000 0000 1234 5678",
  "booked_at": "2026-03-03T10:15:00+01:00",
  "amount": 25.00, "currency": "EUR",
  "vs": "0015501234", "ss": "0145000029", "ks": "0308",
  "counterparty_iban": "SK00 0900 0000 0000 8765 4321",
  "description": "Platba za vstupenky",
  "raw": "…"
}
```

### 3.2 Cesta A1 – online objednávka zaplatená bránou, dokončená z výpisu
**Kontext:** zákazník zaplatil kartou alebo prevodom cez bránu, ale návrat do e-shopu (callback) neprebehol. Košík ostal uzamknutý v `to_sale` a uložený v `basket_serialization`.

1. **`bank-statements` (cron):**
   - stiahne avízá a API a uloží transakcie (`AddBankStatement`),
   - samotné párovanie prebehne už pri zápise v `AddBankStatement`: VS = číslo košíka, hľadá sa v `to_sale` a `to_sale_recovery` u všetkých nájomcov a zámok miest sa predĺži o 30 minút (2.4.1),
   - potom zavolá `PaymentRecovery()`, ktorá košíky spárované v poslednej hodine (`tickets = 1`) zapíše do fronty `mt_payments.basket_recovery` (2.4.2).
2. **`payments-process` (cron):**
   - `GetPaymentRecoveryList(theater.id)` vráti zaplatené a nedokončené košíky (pravdepodobne z `basket_recovery`, telo neoverené),
   - pre každý:
     1. načíta serializovaný košík; ak neexistuje, zapíše chybu „Skipping – basket serialization not exists“ a pokračuje ďalším,
     2. **očakávaná suma** = cena vstupeniek (min. 0) + manipulačný poplatok (iba ak je cena > 0),
     3. **nedoplatok** (`round(zaplatené, 2) < round(očakávané, 2)`): iba varovanie „unexpected error, paid amount (X) differs from the expected amount (Y)“ – **objednávka sa aj tak dokončí**,
     4. **preplatok** sa nekontroluje, tolerancia neexistuje,
     5. `finalizeBuys(košík, "OK", psp_class)` → `FinalizeOMSale` → e-mail so vstupenkami. Chyba v kóde: PSP trieda sa odovzdá obrátene, prázdna → "", neprázdna → "EMAIL".
3. **Idempotencia:** `FinalizeOMSale` vráti „už dokončené“ (`RowAffected = 0`, `StatusPayment = 1`), ak sú všetky sedadlá predané tej istej osobe za tú istú cenu. Druhý beh potom nič nespraví. Zámok medzi súbežnými behmi nie je. Po storne môže oneskorená transakcia sedadlá predať znovu (2.4.4).
4. **Expirácia košíka:** PHP ju nekontroluje. `AddBankStatement` pri nájdení košíka predĺži zámok miest o 30 minút.
   - Ak zámok napriek tomu vypršal, `FinalizeOMSale` obnoví košík zo `to_sale_recovery` a predá ho, len ak sú **všetky** miesta stále voľné (stav 1).
   - Inak zapíše `online_payment` s cenou −1 a vráti `RowAffected = 0`. PHP vyhodí výnimku a pošle e-mail `order_error.txt`.
   - Transakcia má vtedy `tickets = 2` a nájomcu, takže **sa medzi nespárovanými nezobrazí** a peniaze ostanú bez vstupeniek aj bez refundu.

**Požadované správanie v novom systéme:**
| Situácia | Akcia |
|---|---|
| suma = očakávaná (±0,00) a mena sedí | dokončiť objednávku, poslať vstupenky |
| nedoplatok | **nedokončiť**; transakcia do fronty „na kontrolu“ s dôvodom `underpaid` |
| preplatok | dokončiť; rozdiel evidovať ako `overpaid_amount` a do fronty „na vrátenie preplatku“ |
| miesta už nie sú dostupné (košík expiroval a miesta sa predali) | nedokončiť; stav `seats_unavailable`, automatický návrh refundu |
| objednávka už dokončená (duplicitná transakcia) | nič nerobiť; transakciu označiť `duplicate_of = <id>` |

### 3.3 Cesta A2 – rezervácia zaplatená prevodom (OmReserve)
**Spúšťač:** `hourly` každú hodinu v rozsahu 5:00–23:00, **iba v produkcii** (`UnprocessedPayments::finishReservationsByCron`).

1. Načíta nespárované platby (`GetUnprocessedPayments`) s `id_basket > 0` a zo zoznamu vyrobí VS (s nulami aj bez).
2. Nájde objednávky: `seat_note.note IN (VS) OR seat_note.id_basket IN (VS)`.
3. **Záporná suma:** ak ku košíku existuje žiadosť o refund (`seat_note_refund`, `id_basket > 10000000`) a platba ešte nie je vybavená, zavolá `SetUnprocessedPayment(id, theater.id)` → „Automatically process refunded tickets“.
4. **Kladná suma a `note` = VS (po doplnení nulami):** zavolá `createTicketsFromReservation`. **Kontroly v poradí (prvá zlyhaná ukončí spracovanie):**

| # | Kontrola | Hláška pri zlyhaní (sk, v logu hodinového e-mailu) |
|---|---|---|
| 1 | platba je stále medzi nespracovanými | „Invalid bank statement (id_bank_statement).“ |
| 2 | `seat_note.id_basket` je prázdne (vstupenky ešte nevznikli) | „Nákup: Vstupenky už existujú!!! note …, id_basket …“ |
| 3 | existujú sedadlá | „Nenájdené žiadne sedadlá“ |
| 4 | všetky sedadlá majú stav 11 | „Sedadlo nie je rezervácia <stav>“ |
| 5 | jedna faktúra | „Rôzne idInvoice na sedadlách.“ |
| 6 | jedna osoba | „Rôzne idPerson na sedadlách.“ |
| 7 | `id_reservation` nie je NULL | „Na sedadle nebola nájdená rezervácia (id_reservation = null).“ |
| 8 | **presná zhoda sumy:** `round(Σ(cena miesta + poplatok miesta) + poštovné, 4) == round(platba, 4)` | „Suma platby vs suma vstupeniek + poštovné nesúhlasí!!“ |
| 9 | adresa osoby vs adresa doručenia na faktúre (varovanie) | „Adresa osoby sa nezhoduje s adresou doručenia! SKONTROLOVAŤ, ktorá je správna.“ (porovnanie je v kóde chybné, vždy prejde) |
| 10 | faktúra už odoslaná poštou (varovanie) | „POZOR. Na faktúre je info, že už bola poslaná poštou. Je nutné to ošetriť cez admina.“ |

5. **Po úspechu:**
   - `invoice.paid = now()` (ak je NULL),
   - `seat_note.id_basket = seat_note.note`,
   - `seat.id_seat_status = 23` (permanentka 26), `id_sys_user = 2`, `changed = now()`, `id_reservation = NULL`, `id_payment = id_bank_account` (**chyba:** do platobnej metódy sa zapíše ID bankového účtu),
   - `SetUnprocessedPayment(id_bank_statement, theater.id)`,
   - vytvorenie PDF vstupeniek a e-mail `buy.txt` zákazníkovi (pri `psp_class = OmReserve`), inak na support.

Príklad úspešného páru:
```text
Rezervácia: seat_note.note = 0015501234, 2× vstupenka 12,00 € (poplatok 0,50 €/ks), poštovné 2,50 €
Očakávaná suma: 2×(12,00+0,50) + 2,50 = 27,50 €
Platba: VS 0015501234, suma 27,50 €, účet SK00 0900 … → spárované, vstupenky odoslané
Platba: VS 0015501234, suma 27,00 € → „Suma … nesúhlasí!!“, platba ostáva nespárovaná
```

**Požadované správanie v novom systéme:**
- presná zhoda sumy a meny → dokončiť;
- nedoplatok → fronta „na kontrolu“ s návrhom „vyzvať na doplatok“;
- preplatok → dokončiť a evidovať preplatok na vrátenie. **Toto je zmena oproti starému systému**, ktorý preplatok nespáruje; potvrdiť s biznisom;
- platba na už zrušenú rezerváciu → pozri 3.4.

### 3.4 Expirácia rezervácií (`Maintenance/Reservations::processReservations`)
**Spúšťač:** `hourly` o 15:00, iba v pracovné dni (`isWorkDay`).

1. **Výber:** rezervácie `seat.id_seat_status = 11` s platobnou metódou OmReserve.
2. **Pripomienka:** ak `invoice.reservation_reminder` je prázdne a od `seat.changed` uplynuli **2 pracovné dni**, pošle e-mail `reservation_remind.txt` a zapíše `invoice.reservation_reminder = now()`.
3. **Zrušenie:** ak je pripomienka odoslaná, `reservation_cancel` je prázdne a od pripomienky uplynuli **ďalšie 2 pracovné dni**:
   1. pošle e-mail `reservation_cancel.txt`,
   2. **iba po úspešnom odoslaní** zavolá `CancelOMReservation(id_seat_note)`,
   3. zapíše `invoice.reservation_cancel`.

   Pri nezhode e-mailu výsledok „!!! NESEDÍ EMAIL !!!“.
4. **Platba po zrušení:** kontrola „všetky sedadlá majú stav 11“ zlyhá, platba ostane nespárovaná a rieši ju support ručne (zmena VS / náklad / refund). Automatický refund neexistuje.

**Požadované v novom systéme:**
- lehoty ako konfigurácia (predvolene 2 + 2 pracovné dni, sviatky SK/CZ);
- platba prijatá po zrušení → ak sú miesta stále voľné, ponúknuť supportu akciu „obnoviť a predať“; inak automaticky vytvoriť úlohu „vrátiť platbu“ s IBAN protiúčtu.

### 3.5 Duplicitné transakcie
| Zdroj | Staré správanie |
|---|---|
| e-mail | hash Message-ID + poradové číslo platby v e-maile; e-mail sa po spracovaní presunie do IMAP priečinka `Processed` (bez `expunge`) |
| API (Fio, Whitepay, UpDejeuner) | prekrývajúce sa okná (Fio včera–dnes, Whitepay posledných 12 h, UpDejeuner dnes–zajtra) a hash z ID transakcie. Duplicitu rieši `AddBankStatement` podľa dvojice (`message_id_hash`, `amount`) bez unikátneho indexu (2.4.1): súbežné behy môžu vložiť duplicitu a rovnaký hash so zmenenou sumou sa vloží ako nová transakcia. |
| SLSP button / XML | explicitný SELECT `COUNT(*) FROM bank_statement WHERE id_basket AND id_bank_account AND amount` – **pozor:** dve rôzne platby rovnakej sumy k rovnakému košíku sa vyhodnotia ako duplicita |
| mesačný import | deterministický `id_movement` + upsert; opakovaný import toho istého súboru pohyby neduplikuje a ručné úpravy zachová |

**Požadované:** unikátny kľúč `(bank_account_id, external_id)`, kde `external_id` je ID transakcie z banky alebo brány. Hash e-mailu použiť len ako záložný kľúč. Rovnaká transakcia z e-mailu aj z mesačného výpisu sa zlúči podľa `(účet, dátum, suma, VS, protiúčet)` – pri nejednoznačnosti ide do fronty na kontrolu.

### 3.6 Záporné pohyby, storná a refundy
**1. Chargeback / refund Cardpay** (e-mail s `TXN=CB`): suma sa uloží záporná, pôvodný košík sa dohľadá cez `GetBankStatementCardpayByTID(tid)`.

**2. Refund GoPay:** stav `REFUNDED` z API sa uloží ako záporná transakcia.

**3. Refund zákazníkovi – postup operátora** (`Superadmin/Refund.php`, `UltraadminController::refundRequestAction`):
1. **Žiadosť:** `refundRequest(seatIds, dni, urgent)` vloží `seat_note_refund` (`processed = 0`) a `seat_refund`. Pri voľbe „URGENTNE (okamžité storno)“ hneď zavolá `CancelOMSale`.
2. **Kontrola platby (`test`):** cez `GetPayments(idBasket)`:
   - chyba, ak platba neexistuje alebo už existuje záporná (vrátená) platba;
   - ak platba = cena vstupeniek + 2,50 alebo + 2,80, upozornenie „pošta“;
   - refund je povolený, ak cena vstupeniek ≤ prijatá suma.
3. **Suma na vrátenie:**
   `to_refund = cena vstupeniek − servisný poplatok`, kde poplatok = `max(pevný poplatok voľby, vrátená cena × % poplatku / 100)`, voliteľne so stropom `limit_perc`.
4. **Výstup podľa brány, ktorou sa platilo:**
   - Fio: ABO súbor,
   - VÚB / Tatra / SLSP: SEPA pain.001 XML,
   - Cardpay / ČSOB: CSV riadok `VS10;TID;suma;dátum;AC` (TID a AC z popisu pôvodnej platby),
   - GoPay: online refund cez API (`/payments/payment/{id}/refund`), bez zápisu do DB – záporná platba príde neskôr cez API.
5. **Odoslanie e-mailu** (`date_refund_email`), potom **označenie vybavenia** (`date_refund = now()`, voľba zákazníka `status 1 → 2`).
6. **Spárovanie odoslaného refundu z výpisu:**
   - cesta A: `finishReservationsByCron` označí zápornú platbu k žiadosti ako vybavenú,
   - cesta B: typy 15 / 16 (3.7).

**4. Storno bez refundu** (admin `Storno`, superadmin storno):
- vstupenky sa uvoľnia (stav 1, nový čiarový kód), zapíše sa `storno_seat_log`;
- SP ani refund sa nevolajú a väzba na platbu sa nerieši – **neprenášať** ako samostatnú cestu. V novom systéme musí každé storno zaplatenej objednávky vytvoriť záväzok na vrátenie peňazí alebo explicitné rozhodnutie „bez vrátenia“ s dôvodom.

### 3.7 Cesta B – mesačné účtovné párovanie (`admin/app/models/Accounting/Pairing.php`)
Návrh typu pohybu sa počíta pri každom zobrazení. Do DB sa zapíše až po kliknutí „Automatické priradenie“ alebo ručnej úprave. **Pravidlá sa vyhodnocujú v tomto poradí, neskoršie prepisuje skoršie:**

1. **Bankové poplatky (20):** poznámka obsahuje „Poplatok za vedenie účtu“, „Vedenie konta VUB“ alebo „Vedenie konta flexi“.
2. **Odoslaná platba organizátorovi (31):** poznámka obsahuje „Peniaze prijate syst…“ a suma < 0.
3. **Platba za vstupenky (11):**
   - VS (alebo `vs_alt`) = `seat_note.id_basket` objednávky (zo `seat` aj `seat_history`, všetky DB nájomcov),
   - suma > 0,
   - dátum zmeny objednávky je v období (od −10 dní),
   - **a zároveň platí aspoň jedno pravidlo sumy:**
     - a) `platba = cena + manipulačné poplatky + poštovné` (poštovné = `invoice.price − cena vstupeniek`),
     - b) `platba = cena + 0,20` (historický pevný poplatok),
     - c) `|platba − (cena + 0,20) × (1 + % poplatku metódy / 100)| ≤ 0,01`,
     - d) `|platba − (cena + manip. + poštovné) × (1 + % / 100)| ≤ 0,01`,
     - e) `platba = cena + 0,20 + 3,10`.

   Ak je dátum zaúčtovania v neskoršom mesiaci → **12**. Ak `|platba / cena| < 5 %` → **21** (poplatok, nie platba).
4. **Storno (15 / 16):** zatiaľ nepriradené, VS > 14 000 000, suma < 0 a pôvodný nákup existuje. Rovnaký mesiac → 15, iný mesiac → 16.
5. **Zhoda s `bank_statement` / `cardpay_statement`** podľa VS: doplní informáciu do stĺpca „Evid. platby“. Pri `cardpay_statement` nastaví `over_card_system = 1`. Pomer < 5 % → 21.
6. **Výplata organizátorovi (31):** VS má 6 znakov a rovná sa `promoter_report.invoice_no` (±3 mesiace), suma < 0 a poznámka obsahuje „Peniaze prijaté systémom“.
7. **Poplatky organizátorovi (33):** stále nepriradené a VS je `invoice_no` protokolu z posledných 3 mesiacov.
8. **VÚB e-card:** „DTPOPLATOK POS“ → 21 + kartou; „DTPLATBA POS“ → 16 pri zápornej sume, inak 11 + kartou.
9. **Poštovné (2):** „vratenie postovne“ / „vratene postovne“ a suma < 0.
10. **Peniaze z brány (44):** „GOPAY CZECH ODŠTĚPNÝ“.

Príklad:
```text
Pohyb: 2026-03-03, +27,70 €, VS 0015501234, SLSP, pozn. „Platba za vstupenky“
Objednávka 15501234: vstupenky 25,00 €, manip. 0,20 €, poštovné 2,50 € → pravidlo 3a: 25,00 + 0,20 + 2,50 = 27,70 → typ 11
Pohyb: 2026-03-31, −0,95 €, VS 0015501234, pozn. „POPLATOK“ → |−0,95 / 25,00| = 3,8 % < 5 % → typ 21
Pohyb: 2026-04-02, −25,00 €, VS 0015501234 → VS > 14000000, pôvodný nákup v marci → typ 16
```

**Požadované v novom systéme:**
- pravidlá ako **konfigurovateľná tabuľka** (priorita, podmienka, výsledný typ, tolerancia);
- magické konštanty (0,20; 3,10; 2,50; 2,80; 5 %; 14 000 000) ako parametre s dátumom platnosti;
- deterministické poradie **„prvé zhodné pravidlo vyhráva“** namiesto prepisovania.

---

## 4. Podpora bánk a brán

Legenda spôsobu získania: **IMAP** = e-mailové avízo do spoločnej schránky (config `bank.statements.*`); **API** = server-to-server; **Upload** = účtovník nahrá súbor v admine.

### 4.1 Operatívne zdroje (cesta A, `app/models/Maintenance/Payments.php`)

**Spoločné:** spracujú sa len **neprečítané** správy, od najnovšej. Telá sa čítajú bez označenia prečítania (`FT_PEEK`). Po spracovaní sa e-mail presunie do priečinka `Processed` alebo `Skipped`.

| Zdroj | Filter e-mailu (presné reťazce) | Formát a parsovanie | Známe chyby |
|---|---|---|---|
| **ČSOB – Info 24 avízo** (`processCsob`) | odosielateľ obsahuje `@csob.sk`, predmet `ČSOB Info 24 - Avízo` | text/plain base64, CP1250; viac platieb v e-maile, každá končí riadkom `Zostatok na`; `dňa <dátum> bola na účte <účet>MAXITICKET S.R.O.`; riadky `suma:`, `z účtu:` / `v prospech účtu:`, `referencia platiteľa:` (/VS/SS/KS), riadky `VS`/`SS`/`KS`, `detaily platby:`, `Miesto:`; kód banky 7500 | **„csob parser fix“ (cca69cead, 11/2024):** suma sa čítala od zlého znaku (`mb_substr($row, 25)` namiesto 5) → suma 0 alebo zlá; VS/SS/KS sa hľadali len s medzerou (`"VS "`), riadky `VS:` sa neparsovali → platby bez VS ostali nespárované. 1fd0a8096: zmena rozpoznania avíza z adresáta na odosielateľa + predmet a textu „IFNE SOFTWARE“ na „MAXITICKET S.R.O.“. E-mail bez `Zostatok na` sa neoznačí. |
| **ČSOB GP webpay** (`processCsobgpwebpayHtml`) | odosielateľ `gpwebpay@b2b.gpe.cz`, predmet `Portál GP webpay - potvrdenie o zaplatení platby` | HTML v base64; regexy `platba číslo (\d+) na čiastku`, `na čiastku ([\d,\.]+ EUR)`, `bola zaplatená dd.mm.yyyy HH:MM:SS`, `Interné dáta e-shopu: (\d+)_(\d+)` = VS_SS; účet `MAXITICKET.CSOBGPWEBPAY` | suma s oddeľovačom tisícov sa prevedie zle; ako kľúč deduplikácie sa berie samotné číslo platby |
| **Tatra banka – b-mail** (`processTatrapay`) | odosielateľ `b-mail@tatrabanka.sk`; `Kredit na ucte` / `Debet na ucte` → spracovať, `Stav na ucte` → Skipped, `e-commerce` → Cardpay | ISO-8859-2; `<dátum> bol zostatok Vasho uctu <IBAN> zvyseny\|znizeny o <suma> EUR`; `Popis transakcie:`, `Referencia platitela: /VS…/SS…/KS…`, `Ucet protistrany:`; platby kartou (`CP …`) a CZK sa preskočia | – |
| **Tatra banka – CardPay/TatraPay e-commerce** (`processCardpay`) | ako b-mail + `e-commerce` | prvý riadok: (a) `AMT=16.00 CURR=978 VS=1234567 RES=OK AC=123456` → platba (978 EUR, 203 CZK); (b) `… TXN=CB …` → chargeback (záporná suma, košík cez `GetBankStatementCardpayByTID`); (c) `… HMAC=…` bez TXN → druhá notifikácia TatraPay, preskočí sa; (d) `RES=FAIL` → preskočí sa; dátum = dátum e-mailu; účet `MAXITICKET.CARDPAY` (+ mena) | – |
| **Tatra banka – denný výpis CardPay** (`processCardpayVypis`) | odosielateľ `vypis_obchodnik@tatrabanka.sk`, predmet `MAXITICKET_Elektr_denne` (účet 53, CZK 153) alebo `IFNE_ D` (účet 13) | PGP-šifrovaná príloha (gnupg, kľúče v `app/cert/cardpay/`), riadky `\|`, 21 stĺpcov: 0 dátum zúčtovania, 2 dátum transakcie, 7 číslo karty, 8 autorizačný kód, 9 suma, 10 mena, 11 provízia, 18 VS; hlavička sa preskočí; zápis `AddCardpayStatement` | provízia sa ukladá len v surovom riadku |
| **SLSP – HTML notifikácia** (`processSporopayHtml`) | odosielateľ `vypis@slsp.sk` alebo adresát `bt-sporopay@`; predmety `Notifikacia - Platobny prikaz na uhradu / FIT 2.0`, `Notifikacia - Bezhotovostny vklad`, `Notifikacia - Vklad hotovosti` | HTML → text; `Datum: d.m.Y H:M:S`, `Suma:`, `Protiúčet: <IBAN>`, `Referencia:/VS…/SS…/KS…`; kód banky 0900; kľúč = hash („SLSP“ + suma + dátum + IBAN + referencia) | – |
| **SLSP – Notifikacia so ZIP** (`processSporopayDirectPayment`) | predmet presne `Notifikacia` | ZIP chránený heslom (`psp.sporopay.vypis.password`, rozbaľuje sa cez 7z) s TXT (CP1250); `…as platnosti:`, `Názov účtu: BU <účet>`, riadok `VS:…KS:…SS:…`, suma = posledné slovo riadku s „kaz na úhradu“, „Bezhotovostn“ alebo „Vklad hotovost“; **uloží sa len ak SS obsahuje `888888` alebo `000000`** | suma sa nenormalizuje; heslo je viditeľné v zozname procesov |
| **SLSP – Informácia o realizácii platby (SporoPay tlačidlo)** (`processSporopayButton`) | predmet `Informacia o realizacii platby` | spracuje sa až **15 min** po odoslaní e-mailu; CSV `;`: `pu_predcislo;pu_cislo;pu_kbanky;suma;mena;vs;ss;vpos_trans_id;trans_timestamp;auth_code;…;result;real;sign3`; mena musí byť EUR (inak **zastaví celý beh**); preskočí `NOK` | kontrola NOK na zlých stĺpcoch (neoverené); kontrola duplicity podľa (košík, účet, suma) |
| **SLSP – mesačný/denný výpis BU** (`processSporopayVypisBuXml`) | predmet obsahuje `Výpis MaxiTicket - Business účet ` | ZIP (7z) s camt.053; `Ntry`: `BookgDt/Dt`, `Amt`, `CdtDbtInd`, `RltdPties/DbtrAcct\|CdtrAcct`, `Refs/EndToEndId` (/VS/SS/KS), `RmtInf/Ustrd`; „Bezhotovostny vklad“ so SS bez 888888/000000 sa preskočí (internetový predaj) | – |
| **VÚB e-platby – upozornenie** (`processVUBeplatbyDirectPayment`) | odosielateľ `nonstopbanking@vub.sk` alebo adresát `bt-vub-eplatba@`; predmet `Upozornenie o zrealizovanej transakcii` (iné → Skipped) | text base64; `na účte <IBAN> dňa <dátum> o <čas> bola zrealizovaná kreditná\|debetná transakcia vo výške <suma> EUR.`; `Variabilný symbol:`, `Konštantný symbol:`, `Špecifický symbol:`, `Účet partnera:`, `Popis:` (VS z popisu, ak chýba) | tlačidlová verzia (ZIP s TXT) je vypnutá |
| **VÚB e-card** (`processVUBecard`) | odosielateľ `eway2pay@intesasanpaolocard.com` / `eway2pay@mercury-processing.com`, predmet `Merchant Email Template v.1.0.` | riadky `MerchantName:`, `TransactionDate: dd.mm.yyyy`, `OrderID:`, `Amount: 14.00`, `CardType:`, `Description: SS:<ss>_<vs>` | brána v produkcii vypnutá |
| **GoPay – e-mail** (`processGopay`) | adresát `bt-gopay@` | quoted-printable; `Datum vytvoření objednávky:`, `Částka: <suma> <MENA>`, `Celková částka všech návratek:` (záporná), `ID objednávky:` → VS, `ID platby:`, `Stav objednávky:` (iné ako ZAPLACENO/VRÁCENA sa neuloží); účet `MAXITICKET.GOPAY[mena]` | – |
| **GoPay – REST** (`processGopayRESTAPI`, spúšťa aj notifikačný endpoint) | – | `state` PAID / REFUNDED; suma = `amount / 100`; VS = `order_number` (pad 10); účet 96 (EUR) / 117; popis obsahuje číslo karty | dátum = čas spracovania, nie platby |
| **Fio – API** (`processFIOoverAPI`) | – | `GET https://www.fio.cz/ib_api/rest/periods/<token>/<včera>/<dnes>/transactions.json`; stĺpce: 22 ID pohybu, 0 dátum, 1 objem, 2 protiúčet, 3 kód banky, 5 VS, 16 správa, 10 názov protiúčtu, 25 komentár, 17 ID pokynu; e-maily `bt-fio@` sa len presunú do Skipped | bez ošetrenia chýb a timeoutov; token je v URL; mena sa nečíta |
| **Whitepay – API** (`processWhitepayOverAPI`) | – | `GET <url>/private-api/crypto-orders/<slug>?date_from=<teraz−12h>&date_to=<teraz>&per_page=100&page=N`, Bearer token; iba `status = COMPLETE`; suma = `value`, ak `received_total + 0,01 == value`, inak `received_total`; VS = `external_order_id` | `curl_errno() === false` → chyby sa ignorujú; `var_dump` |
| **UpDejeuner – API** (`processUpDejeunerOverAPI`) | – | `GET <urlApi>api/transactions/GetTransactionsReport?from&to&termID&sign=sha1(termID + from + to + secret)&returnRefunded=true`; `state` PAID / REFUNDED; VS = `vari`; účet 95; poplatok 5 % (a2df5fd0b) | výnimky sa ticho zahodia |
| **Viamo** (`processViamo`) | odosielateľ `VIAMO <noreply@viamo.info>` | JSON príloha `payment.processedOn, bid, amount, vs, ss, id` | brána vypnutá – neprenášať |

### 4.2 Mesačné importy (cesta B, `admin/app/models/Accounting/BankStatement/*`)
| Parser (`bank_account.psp_class`) | Formát | Parsovanie | Známe chyby |
|---|---|---|---|
| **Comgateczeur** | CSV `;`, úvodzovky, UTF-8 s BOM (aj CP1250) | hlavičky sa normalizujú na ASCII; povinné: `Datum převodu`, `ID Comgate`, `Metoda`, `Variabilní symbol převodu`, `Měna`, `Převedená částka`; `date` = zaplacení / založení / převodu; `date_acc` = převodu; poznámka = „metoda / ID / typ karty / merchant“; obdobie = celé mesiace min–max; zostatky 0 | **poplatky (`Poplatek celkem`) sa neukladajú**; chyby „Missing required Comgate column: X“, „Comgate CSV is empty.“, „No importable detail rows were found in Comgate CSV.“ |
| **Csobgpwebpay** | XLSX / XLS / CSV z portálu GP webpay | prvých 6 riadkov hlavička; stĺpce 0 vytvorené (`d.m.Y H:i:s`), 1 číslo platby, 2 číslo objednávky → VS, 4 spôsob, 5 stav, 8 suma, 11 mena, 12 maskované číslo karty | **obdobie je vždy minulý mesiac podľa dnešného dátumu**; filter „iba zaplatené“ nefunguje (`strpos != 0`); pri zlom dátume fatal error; načítanie cez PhpSpreadsheet 2.2.2 (zraniteľné, audit 8.2) |
| **Sporopay** | MT940 TXT | `:60F:` / `:62F:` zostatky (C/D, oprava znamienka e6f59afb5), `:61:yymmdd…CR\|DR<suma>` pohyb, `:86:` poznámka, `?20KS:`, `?21VS:`, `?22SS:`, `?38` IBAN, zápis pri `?61.` | každému riadku sa odreže posledný znak (predpoklad CRLF) – pri LF poškodí dáta |
| **Tatrapay, Tatrapaycz, Csobpay** | camt.053 XML | `Stmt/FrToDt`, `Bal` OPBD/CLBD, `Ntry`: `BookgDt/Dt`, `Amt`, `CdtDbtInd`, `DbtrAcct/Id/IBAN`, `Refs/EndToEndId` (/VS/SS/KS), `NtryRef` + `Dbtr/Nm` + `RmtInf/Ustrd` → poznámka | pohyby mimo `FrToDt` vytvoria súhrn bez obdobia |
| **Fiocz** | CSV `;` (SK/CZ varianty hlavičiek) | „Počáteční stav účtu k …“, „Koncový stav…“, „Suma příjmů:“, „Suma výdajů:“; stĺpce „ID operace“, „Datum“, „Objem“, „Měna“, „Protiúčet“, „Kód banky“, KS/VS/SS | počty kreditov a debetov sa nepočítajú |
| **Vubeplatby** | ABO / GPC (pevné pozície) | `074` hlavička (dátum, zostatky, obraty /100), `075` pohyb: protiúčet [19,16], suma [48,12]/100, kód účtovania [60] (1, 5 debet; 2, 4 kredit), VS [61,10], KS [77,4], SS [81,10], dátum [122,6]; mena EUR | import padá: `Helper::parseAboMovement` odkazuje na neexistujúce konštanty; nezhoda názvu triedy `VubEPlatby` / `Vubeplatby` |
| **Gopaysk, Gopaycz** | CSV `;` | „ID pohybu“, „Datum“ (neparsuje sa), „Částka“, „Měna“, „ID objednávky/VS“; filter meny EUR/CZK | zdroj zostatkov (stĺpce 10 a 11) je nejasný |
| **Updejeuner** | bez súboru – API za minulý mesiac | `cardNumber`, `orderNumber` → VS, `created`, `processed` → `date_acc`, `amount` (REFUND záporne) | bez timeoutu a kontroly odpovede |

### 4.3 Anonymizované vzorky vstupov
```text
ČSOB Info 24 (text):
  Vážený klient, dovoľujeme si Vám oznámiť, že dňa 03.03.2026 bola na účte SK0075000000000012345678 MAXITICKET S.R.O. pripísaná platba
  suma: 27,70 EUR
  z účtu: SK0009000000000087654321
  referencia platiteľa: /VS0015501234/SS0145000029/KS0308
  Zostatok na účte: …

Tatra CardPay e-commerce (prvý riadok):
  AMT=27.70 CURR=978 VS=15501234 RES=OK AC=123456

SLSP MT940:
  :60F:C260228EUR1000,00
  :61:2603031015CR27,70NMSCNONREF
  :86:xxxxxxPlatba za vstupenky
  ?21VS:15501234
  ?38SK0009000000000087654321
  ?61.
  :62F:C260331EUR1027,70

camt.053 (Ntry):
  <Ntry><NtryRef>REF1</NtryRef><Amt Ccy="EUR">27.70</Amt><CdtDbtInd>CRDT</CdtDbtInd>
  <BookgDt><Dt>2026-03-03</Dt></BookgDt><NtryDtls><TxDtls><Refs><EndToEndId>/VS15501234/SS/KS0308</EndToEndId></Refs></TxDtls></NtryDtls></Ntry>

Comgate CSV:
  Merchant;Datum založení;Datum zaplacení;Datum převodu;…;ID Comgate;Metoda;…;Variabilní symbol převodu;…;Měna;…;Převedená částka;Poplatek celkem;…;Typ karty
  123456;2026-03-02 10:11:12;2026-03-02 10:12:00;2026-03-04;…;ABCD-EFGH-IJKL;Card;…;15501234;…;EUR;…;27,20;0,50;…;VISA

Fio API (JSON, výrez):
  {"column22":{"value":1234567890},"column0":{"value":"2026-03-03+0100"},"column1":{"value":27.7},"column5":{"value":"15501234"},"column16":{"value":"Platba za vstupenky"}}
```

---

## 5. Admin UI

Existujúce obrazovky sú vypisované HTML priamo z modelov. Nasledujúci zoznam je funkčný rozsah, ktorý musí nový systém pokryť. Texty v úvodzovkách sú pôvodné hlášky.

### 5.1 Nespracované platby (support) – `/superadmin/uprocessed-payments`
- **Zoznam:** `GetUnprocessedPayments` – dátum, účet (názov, mena), suma, VS, košík, transakcia, popis. Pri nenájdenej objednávke text „Nenájdené…“ + transakcia / popis.
- **Akcie na riadku:**
  - „Vytvoriť vstupenky“ (`operation=tickets` → `createTicketsFromReservation`, výpis kontrol z 3.3),
  - „Zrušiť rezerváciu“ (`operation=cancel` → e-mail sysadminovi „Ručne zrušená rezervácia (idSeatNote: X)“),
  - „Zmeniť VS“ (`operation=changevs` → nový `id_basket` na transakcii),
  - „Vybaviť ako náklad“ (`operation=setgt0` → `id_global_theater = 0`).
- **Súvisiace:** „Ticket recovery“ – ručné opätovné poslanie vstupeniek podľa objednávky.
- **V novom systéme:** všetky akcie ako POST s CSRF, povinný dôvod pri „náklad“ a „zmena VS“, auditný záznam (kto, kedy, pred/po).

### 5.2 Bankové výpisy (účtovník) – `/accounting/bank-statements`
- **Nadpis a info:** „Bankové výpisy“, info o module a zoznam podporovaných formátov („FIO BANKA CSV - mesačný, SPOROPAY MT940 TXT mesačný, TATRAPAY, ČSOB XML výpis do účtovníctva (mesačne iba!), VUBEPLATBY ABO výpis mesačný …, UPDEJEUNER len potvrdiť bez súboru, natiahne si cez API.“).
- **Formulár:** „Účtovné obdobie:“ (rok, od aktuálneho po 2019), „Nahrať výpis:“ (bankový účet), súbor, tlačidlo „Potvrdiť“.
- **Tabuľka pre každý účet** (12 mesiacov):
  - **Stĺpce:** Mesiac (odkaz na párovanie), Výpis od, Výpis do, Poč. stav, Kreditné / poč. ks, Debetné / poč. ks, Poplatky, Konc. stav, Mes. výpis kreditné, Mes. výpis debetné, Poč. nepriraď., Pohyby kreditné, Pohyby debetné, Pozn. (ikona „XML výpis“).
  - **Chýbajúci výpis:** „Neexistuje výpis YYYY-MM“ (minulý mesiac = chyba, aktuálny = varovanie).
  - **Kontrola zostatkov:** „Nesedí počiatočný stav, kredity/debety voči koncovému stavu: X <> Y“ (`koncový − kredity + debety + poplatky = počiatočný`).
  - **Nadväznosť mesiacov:** „Nesedí počiatočný s koncovým budúceho výpisu …“.
  - **Súčty:** súčty pohybov a transakcií z cesty A sa porovnávajú so súhrnom výpisu (ok / chyba).
  - **Nepriradené pohyby:** počet > 0 sa zvýrazní červeno.
- **Chyby uploadu:** „Súbor s výpisom nebol načítaný.“, chyby PHP uploadu, chyby parsera (4.2).

### 5.3 Párovanie mesiaca – `/accounting/pairing?filterIdAccBankSummary=<id>`
- **Nadpis:** „Mesačný výpis - párovanie <banka> dd.mm.yyyy - dd.mm.yyyy“ + súhrn: Banka, Perióda, Poč. stav, Suma kreditov, Suma debetov, Poplatky, Konc. stav.
- **Sekcia „Prepárovanie platby so zlým VS“:** transakcie z cesty A, kde VS ≠ spárovaný košík (Dátum, Suma, Pôvodný VS, Nový VS) + „Ostatné si treba dohľadať vo výpisoch …“.
- **Sekcia „Položky výpisu z účtu“:**
  - **Tlačidlá:** „Automatické priradenie“, „Filtrovať nepriradené“, „Hromadná zmena platby“.
  - **Stĺpce:** výber, Dátum (štítok „účt. <dátum>“ pri inom mesiaci), Celkom (štítok „Kartou“), Z toho pošta, VS/KS/SS („OPRAVA VS: …“), Protiúčet, Upraviť, Označenie platby (aktuálny typ, červeno pri nesúlade s návrhom), Nákupy v systéme, Evid. platby, Protokoly, Návrh označenia, Pozn.
  - **Zvýraznenie:** ručne zmenené riadky majú žlté pozadie.
- **Modálne okno „Upraviť typ pohybu“:**
  - Typ pohybu (číselník),
  - „Z toho poštové poplatky“,
  - „Z toho manip.poplatky“,
  - „Oprava var.symbolu“,
  - „Kartový systém (Cardpay/ECard)“,
  - „Zmeniť“ / „Zrušiť“.
- **Hromadná zmena:** „Upraviť typ pohybu pre N platieb/platby/platbu.“, bez výberu „Vyberte platby.“.
- **Po automatickom priradení:** „Párovanie ukončené.“.
- **V novom systéme:**
  - automatické priradenie ako **jedna serverová dávka** (nie AJAX po riadkoch),
  - náhľad zmien pred potvrdením,
  - zrušenie spárovania ako samostatná akcia,
  - história zmien riadku.

### 5.4 Kontroly – `/accounting/review`
- **Filtre:** Zostava („[Vyberte zostavu]“), Mesiac (24 mesiacov), „[Všetko]“ / „Problematické“, Mena. Bez zostavy: „Nie je vybratá zo zoznamu žiadná zostava. Vyberte si prosím zostavu cez filter.“
- **Zostavy potrebné pre párovanie:**
  - **5 „Chyby párovania bank. účtov“:** predaje mesiaca vs kladné pohyby, rozdiel súm alebo poplatkov. Voľba „fix“ zapíše poštovné a manipulačné poplatky – v novom systéme len s náhľadom a auditom.
  - **2:** nesúlad účtu refundu s účtom platby, akcia „Fix“ opraví účet v `seat_refund`.
  - **6 / 6B:** spracované refundy bez záporného pohybu v mesiaci.
  - **23:** rovnaký košík zaplatený z viacerých účtov (dvojitá platba).
  - **24:** súčty manipulačných poplatkov podľa účtu a typu.
  - **1/1B, 3/3B, 4/4B, 20–22:** prehľady.
- **Pod tabuľkou:** súhrny, „Čas generovania: X sec. Počet položiek: N“, export XLSX.

### 5.5 Celkový report – `/accounting/report`
Matica za mesiac: riadky = kategórie (KREDITY, KREDITY (nasl. mesiac), Poštovné, Mylné platby, …, Nepriradené), stĺpce = bankové účty + „Nezaradené“ + „Spolu“. Filter meny.

### 5.6 Bilancie – `/accounting/bilancie`
Filter mesiac a mena, „Nová záložka v google sheets:“, tlačidlo „Generovat“. Výsledok sa zapíše do Google Sheets – v novom systéme nahradiť exportom XLSX/CSV alebo vlastným reportom.

### 5.7 Refundácie – `/ultraadmin/refund-request`
- **Zoznam žiadostí:**
  - dni do refundu (červená ≤ 0, žltá ≤ 10), cena a počet, suma na vrátenie (červená, ak prevyšuje prijatú platbu), brána, podujatie, organizátor, zákazník, IBAN (červené „IBAN na vrátenie ZMENA:“);
  - filtre „Only non-OK“ / „Všetky refundácie“ a výber brány.
- **Akcie:**
  - „storno“,
  - „test“ (kontrola platby),
  - vygenerovanie dávky (SEPA / CSV / ABO),
  - „GoPay refundácia“ (stav „Nepodarilo sa overit stav v GoPay“),
  - odoslanie e-mailu,
  - označenie „refundované“,
  - nastavenie alebo vyžiadanie IBAN.
- **Detail objednávky:** tabuľka sedadiel s checkboxom, voľba „URGENTNE (okamžité storno)“ (predvolene zaškrtnutá), tlačidlo „Refundovať označené vstupenky“.

### 5.8 Platby organizátorom – `/promoter-payment/list`
- **Stĺpce:** organizátor, protokol, typ (Príprava / Schválené), VS, SS (IČO), IBAN, suma, dátum schválenia a zaplatenia, poznámka, „Nájdené platby“ (spárované transakcie podľa VS).
- **Zvýraznenie:**
  - zelená: nájdená suma = −suma výplaty alebo ručne označené,
  - žltá: vyplnený dátum zaplatenia,
  - červená: duplicitný VS,
  - ikona „nesedí iban s organizátorom“.
- **Akcie:**
  - „Automatické založenie platieb z protokolov“ („Platby boli automaticky založené.“),
  - „Hromadná platba (Tatrabanka XML)“ / „(VUB XML)“ / „(ČSOB XML)“,
  - „Označiť ako zaplatené“.

---

## 6. Automatizácia

### 6.1 Cron úlohy starého systému
**Plánovač nie je v tomto repozitári.** Crony definuje projekt `MaxiTicket/scheduler` (spúšťa ho GitLab CI job `trigger_scheduler_build`) a volá `/maintenance/*` cez HTTP. Frekvencie sú preto **neoverené – doplniť zo `scheduler`**.

| Úloha | Endpoint | Frekvencia | Čo robí | Závislosti |
|---|---|---|---|---|
| Sťahovanie výpisov | `/maintenance/bank-statements` | neoverené (predpoklad: každých 5–15 min) | Whitepay API → Fio API → IMAP (1. a 2. schránka) → `PaymentRecovery()` → UpDejeuner API | IMAP a API dostupné, root DB spojenie |
| Dokončenie online košíkov | `/maintenance/payments-process` | neoverené | `GetPaymentRecoveryList` → dokončenie objednávok; SMS kontrola nespracovaných | po `bank-statements` |
| Hodinová údržba | `/maintenance/hourly` | každú hodinu | 5–23 h: dokončenie rezervácií z platieb; 15:00 (pracovné dni): pripomienky a rušenie rezervácií; na konci e-mail „Hourly maintenance / tickets / production“ s logom | beží len pre nájomcu `tickets` |
| Odosielanie e-mailov | `/maintenance/mail-over-cron` | každú minútu (komentár v kóde) | fronta e-mailov vrátane vstupeniek (pri zapnutom `mail.over.cron` bez PDF príloh, len odkaz) | – |

### 6.2 Idempotencia a zámky (staré správanie)
- **Zámky:** súbežné behy nie sú chránené. `Application_Model_Cron::adaptiveRunStart` existuje, ale pri platbách sa nepoužíva. Anonymné volanie endpointu počas behu cronu môže platbu spracovať dvakrát (audit 5).
- **Dokončenie objednávky:** chráni ho odpoveď `FinalizeOMSale` („už dokončené“), ale kontrola a dokončenie nie sú atomické (audit 3.6).
- **E-maily:** presúvajú sa do `Processed` / `Skipped`. Neplatné ostávajú neprečítané a spracúvajú sa pri každom behu.

### 6.3 Logovanie a notifikácie (staré)
- **Logy:**
  - `info("… CALL AddBankStatement " + parametre)` – vrátane IBAN a čísel kariet (neprenášať),
  - varovanie o nesúlade sumy,
  - chyby curl a chýbajúcej serializácie košíka.
- **SMS** `Unprocessed payments [N]: last <dátum> = <suma vstupeniek> vs <suma platieb>`: pri nesúlade súm, ak posledná platba je staršia ako 10 min a mladšia ako 7 dní.
- **E-mail** „Hourly maintenance / <nájomca> / <prostredie>“ s HTML logom spracovania rezervácií.
- **Chýbajú upozornenia na:**
  - zlyhanie IMAP prihlásenia,
  - nedostupné API,
  - neparsovateľný e-mail,
  - dlhodobo nespárovanú platbu.

### 6.4 Požadované v novom systéme
- **Plánovanie:**
  - úlohy v rámci aplikácie (Supabase cron / pg_cron alebo worker), nie verejné HTTP endpointy;
  - každý beh v tabuľke `job_runs` (štart, koniec, stav, počty spracovaných/chýb).
- **Súbeh a opakovanie:**
  - zámok na úlohu (`pg_try_advisory_lock`) a na objednávku pri dokončení (`SELECT … FOR UPDATE`);
  - idempotentný ingest (unikátny kľúč 3.5) a opakovateľné spracovanie (stavový automat transakcie: `received → parsed → matched | needs_review | ignored`).
- **Frekvencie:**
  - API brán a bánk každých 5 min s prekryvom okna 2 dni;
  - e-mailové avízá každých 5 min;
  - rezervácie každú hodinu;
  - pripomienky raz denne o 15:00 v pracovné dni.
- **Upozornenia (e-mail/Slack):** zlyhaný beh, 0 transakcií z účtu dlhšie ako N hodín počas pracovného dňa, nespárovaná platba staršia ako 24 h, nesúlad súm objednávky.
- **Logy bez citlivých údajov:** maskovať IBAN (posledné 4 znaky) a karty; surový obsah ukladať šifrovane s obmedzenou retenciou.

---

## 7. Účtovné výstupy

### 7.1 Mesačný výpis pre účtovníctvo (camt.053)
Starý systém: `ExportSepaXml` – **nie je to pain.001, ale camt.053.001.02**.
- **Vstup:** pohyby jedného mesačného súhrnu (`acc_bank_movement`) s priradeným typom.
- **Agregácia:**
  - typy 1, 2, 11, 12, 15, 16, 20, 21 sa za mesiac zlúčia do jednej položky za typ (bez VS a protiúčtu), ostatné typy zostávajú po pohyboch;
  - z každej skupiny sa odčíta poštovné a manipulačné poplatky, ktoré sa vykážu ako samostatné položky „Poštovné“ a „Manipulačné poplatky“.
- **Štruktúra XML:**
  - `GrpHdr/MsgId` = ID súhrnu,
  - `Stmt/Id` = `IBAN-0MM-yymmdd`,
  - `Acct` (IBAN, mena, vlastník – napevno IFNE Software alebo MaxiTicket podľa ID účtu),
  - `Bal` PRCD / OPBD / CLBD,
  - `TxsSummry`,
  - `Ntry` (`NtryRef` = `id_movement`, `Amt` = absolútna hodnota na 2 desatinné miesta, `CdtDbtInd` podľa znamienka – oprava e6f59afb5, `BookgDt`, `ValDt`, `EndToEndId` = `/VS…/SS…/KS…`, protistrana „typ: poznámka“ max. 70 znakov ASCII).
- **Známe chyby:** preklep v hlavičke `Content-Desposition` (súbor sa nestiahne ako príloha), chýba `xmlns`, firemné údaje sú napevno.
- **Nový systém:** vlastník účtu a identifikátory z konfigurácie, validácia voči XSD pred stiahnutím.

### 7.2 Výplaty organizátorom (SEPA pain.001.001.03)
- **Založenie výplat:** `promoter_report` (protokol, `amount > 0`) → `promoter_report_payment` (VS = číslo protokolu, SS = IČO, IBAN organizátora).
- **Dávka:**
  - jeden `PmtInf` na platbu,
  - dlžník = IBAN spoločnosti podľa banky (napevno v kóde),
  - `EndToEndId` = `/VS/SS/KS0308`,
  - BIC odvodený z kódu banky v IBAN,
  - `Ustrd` = „Peniaze prijate systemom MaxiTicket na zaklade Mandatnej zmluvy“.
- **Spárovanie zaplatenia:** v cestách A a B je to iba vizuálna zhoda („Nájdené platby“, typ 31); stav výplaty sa automaticky nemení.
- **Nový systém:** po spárovaní odchádzajúcej platby s VS protokolu automaticky nastaviť `paid_at`. `CtrlSum` v `GrpHdr` a XML deklarácia sú povinné.

### 7.3 Faktúry (SuperFaktúra)
- **Vstup:** faktúry organizátorom za províziu vznikajú z predajnej štatistiky (`GenerateStatisticForUser_web`) a z `promoter_report`.
- **Väzba na výpisy:** z výpisov **nečerpajú** a úhrady faktúr sa z výpisov nepárujú.
- **Nový systém:** voliteľne párovať prichádzajúce platby na vydané faktúry podľa VS = číslo faktúry (typ 33).

### 7.4 Reporty organizátorom a finančné štatistiky
- **Zdroj:** predajné reporty (`FinanceStats`, `EventReportController`, `Report`) počítajú z predaja (`seat`, `seat_history`, `payment`), nie z bankových transakcií.
- **Rozpis platieb:** rozpis podľa platobnej metódy (`id_payment`); terminálové poplatky (`promoter_serv_price`, typ služby 11) sa rozpočítavajú podľa `seat.id_payment`.
- **Riziko:** rezervácia dokončená z výpisu dostane do `seat.id_payment` ID bankového účtu (3.3), čo skresľuje rozpis platieb v reportoch. V novom systéme ukladať platobnú metódu a bankový účet oddelene.

---

## 8. Neprenášať – známe chyby a bezpečnostné problémy (z `docs/audit-2026-09.md`)

| # | Problém v starom systéme | Zdroj | Požiadavka na nový systém |
|---|---|---|---|
| 1 | Cron endpointy `/maintenance/bank-statements`, `payments-process`, `hourly`, `mail-over-cron` sú volateľné anonymne cez HTTP (`onlyCLI()` zakomentované) | audit 5 | úlohy iba interne; ak musí existovať HTTP spúšťač, tak s podpísaným tokenom (`hash_equals`), rate limitom a zámkom |
| 2 | Avízá z e-mailu sa rozlišujú podľa hlavičiek From/To, ktoré sa dajú sfalšovať – podvrhnutý e-mail s VS a sumou vedie k vydaniu vstupeniek | audit 3.5 | e-mail len ako doplnkový zdroj; overiť DKIM/SPF (`Authentication-Results` vlastného MTA) a doménu; preferovať API a súbory bánk; operatívne dokončenie z e-mailu iba pri zhode s neskorším API/výpisom alebo s ručným potvrdením |
| 3 | Nesúlad sumy sa iba loguje, objednávka sa dokončí aj pri nedoplatku | audit 3.2, kód `Payments.php:2329` | nedoplatok = needs_review, nikdy automatické vydanie |
| 4 | Stav TOUT sa považuje za zaplatené | audit 3.6 | vydať vstupenky až po potvrdení platby |
| 5 | Podpísané dáta brány nie sú viazané na objednávku, chýba overenie podpisu pri viacerých bránach | audit 3.3, 3.4 | overovať podpis/HMAC každého callbacku, väzba VS/order_id ↔ objednávka, časová pečiatka |
| 6 | Heslá IMAP, GoPay a heslá archívov natvrdo v kóde a konfigurácii v gite | audit 6.2, 6.3 | secrets výlučne v secret store (Supabase Vault / env), rotácia |
| 7 | Import a párovanie bežia pod root účtom DB | audit 3.6, 4.5 | samostatná rola s minimálnymi právami, RLS pre admin API |
| 8 | Citlivé údaje v logoch (celé callbacky, IBAN, čísla kariet, parametre SQL) | audit 7.2 | maskovanie, žiadne PAN v logoch ani v `description` |
| 9 | Vypnuté overovanie TLS mimo produkcie, UAT s produkčnými tokenmi | audit 3.6 | TLS vždy, oddelené testovacie účty brán |
| 10 | Chýba CSRF, zmeny stavu cez GET (`changevs`, `setgt0`, `?fix=1`, hromadné zmeny) | audit 1.11 | POST + CSRF / SameSite, auditný záznam každej ručnej zmeny |
| 11 | Uložené XSS z údajov zákazníka a výpisu (meno, IBAN, poznámka) v admin tabuľkách | audit 2.3 | escapovanie všetkých polí, CSP |
| 12 | `exec("7z … -p<heslo>")` – heslo v zozname procesov, názov prílohy v ceste | audit 2.6 | knižnica na rozbalenie v pamäti, sanitizácia názvov, dočasné súbory s náhodným názvom |
| 13 | Zraniteľný PhpSpreadsheet `IOFactory::load` na nahraný súbor (XXE, SSRF) | audit 8.2 | whitelist formátu podľa účtu, limit veľkosti, parsovanie v izolovanom workeri |
| 14 | Chýbajúci zámok pri dokončení objednávky (súbeh návratu z brány, notifikácie a cronu) | audit 3.6 | transakčný zámok na objednávku |
| 15 | Neplatné e-maily sa spracúvajú donekonečna bez upozornenia; `terminate()` pri inej mene zastaví celý beh | kód | izolácia chýb po položkách, stav `parse_error`, upozornenie |
| 16 | Magické konštanty (0,20; 3,10; 2,50; 2,80; 5 %; VS > 14 000 000; napevno ID účtov 13/53/95/96/117/153) | kód | konfigurácia s platnosťou od-do |
| 17 | `seat.id_payment` = ID bankového účtu pri dokončení rezervácie | kód | oddelené polia |
| 18 | Storno bez väzby na refund (admin a superadmin storno) | kód | každé storno zaplatenej objednávky vytvorí záväzok refundu alebo zdôvodnené „bez vrátenia“ |
| 19 | Nepresné dátumy (Fio čas spracovania, GoPay „teraz“) | kód | ukladať dátum z banky/brány a čas prijatia oddelene |

**Architektonické odporúčania:**
1. **Jedna tabuľka transakcií** pre obe cesty (`bank_transactions`), zdrojový záznam (`raw_payload`, šifrovaný) a normalizované polia. Ingest adaptér na zdroj s rozhraním `fetch() → RawRecord[]`, `parse(RawRecord) → Transaction`.
2. **Matching engine** ako čistá funkcia `match(transaction, candidates, rules) → {decision, order_id?, reason, confidence}`. Pravidlá v DB a každé rozhodnutie s dôvodom v `transaction_matches`.
3. **Stavový automat objednávky** so zámkom, dokončenie iba v jednej službe, ktorú volá callback brány, matching aj support.
4. **Refundy** ako vlastná entita (`refunds`) naviazaná na objednávku aj na odchádzajúcu transakciu.
5. **Auditný log** všetkých ručných zásahov.

### 8.1 Návrh minimálneho dátového modelu v Postgres (orientačný)
```sql
bank_accounts(id, name, iban, currency, provider, provider_account_ref, active)
ingest_sources(id, bank_account_id, kind /* api|imap|upload */, config_ref, last_success_at)
bank_transactions(id, bank_account_id, source_id, external_id, booked_at, value_date, received_at,
  amount numeric(12,2), currency, vs, ss, ks, counterparty_iban, counterparty_name, description,
  raw_payload_encrypted, status /* received|parsed|matched|needs_review|ignored|parse_error */,
  UNIQUE(bank_account_id, external_id))
transaction_matches(id, transaction_id, order_id, reservation_id, refund_id, rule_code, decision,
  expected_amount, difference, decided_by /* system|user */, decided_at, note)
orders(id, order_no /* = VS */, status /* pending_payment|reserved|paid|cancelled|refunded */, total, currency,
  payment_method, reservation_expires_at, reminder_sent_at, cancelled_at, paid_at)
refunds(id, order_id, amount, fee, iban, method, status /* requested|approved|exported|sent|confirmed */,
  outgoing_transaction_id, created_by, created_at)
accounting_movements(id, transaction_id, period, movement_type_id, amount_delivery, amount_fees, manual)
matching_rules(id, priority, scope /* operational|accounting */, condition jsonb, result, tolerance, valid_from, valid_to)
job_runs(id, job, started_at, finished_at, status, stats jsonb, error)
audit_log(id, actor, action, entity, entity_id, before jsonb, after jsonb, at)
```

---

## 9. Akceptačné testovacie scenáre

Scenáre popisujú **požadované správanie nového systému**. Kde sa líši od starého, je to uvedené.

**Spoločné testovacie dáta:**
- účet `SK00 0900 0000 0000 1111 2222` (EUR),
- objednávka `15501234`: 2× vstupenka 12,00 €, poplatok 0,50 €/ks, doručenie e-mailom,
- **očakávaná suma 25,00 €**.

### T1 – Presná suma (online objednávka, návrat z brány zlyhal)
1. Objednávka je v stave `pending_payment`, košík je uzamknutý.
2. Ingest prijme transakciu: +25,00 EUR, VS `0015501234`, `external_id` `TXN-001`.
3. Beh párovania.

**Očakávané:**
- transakcia `matched`, pravidlo `exact_amount`;
- objednávka `paid`, vstupenky predané, jeden e-mail so vstupenkami;
- `job_runs` zaznamená 1 spárovanú transakciu.

### T2 – Preplatok
1. Transakcia +30,00 EUR, VS `0015501234`.

**Očakávané:**
- objednávka `paid`;
- záznam párovania `difference = +5,00`;
- vznikne úloha „vrátiť preplatok 5,00 €“ s IBAN protiúčtu;
- účtovne: 25,00 € typ „Platba za vstupenky“, 5,00 € „Preplatok“.

*(Starý systém: online košík sa dokončí bez evidencie preplatku; rezervácia sa nespáruje vôbec.)*

### T3 – Nedoplatok
1. Transakcia +20,00 EUR, VS `0015501234`.

**Očakávané:**
- transakcia `needs_review`, dôvod `underpaid`, rozdiel −5,00 €;
- objednávka ostáva `pending_payment` / `reserved`, **žiadne vstupenky**;
- upozornenie supportu.

*(Starý systém: online košík sa dokončí s varovaním v logu.)*

### T4 – Duplicitný výpis
1. Importuj denný výpis s transakciou `TXN-001` (+25,00 EUR, VS `0015501234`).
2. Importuj ten istý súbor znova.
3. Prijmi avízo e-mailom k tej istej platbe (iné `external_id` z e-mailu, rovnaký účet, dátum, suma, VS).

**Očakávané:**
- po kroku 2 počet transakcií = 1 (unikátny kľúč), ručné úpravy zachované;
- po kroku 3 sa e-mailové avízo zlúči s existujúcou transakciou alebo označí `duplicate_of`;
- objednávka dokončená iba raz, jeden e-mail so vstupenkami.

### T5 – Platba na expirovanú rezerváciu
1. Rezervácia `15501234` (OmReserve) vytvorená v pondelok 9:00.
2. V stredu o 15:00 sa pošle pripomienka (2 pracovné dni); v piatok o 15:00 sa rezervácia zruší, vstupenky sú voľné.
3. V sobotu príde platba +25,00 EUR, VS `0015501234`.

**Očakávané:**
- transakcia `needs_review`, dôvod `reservation_cancelled`;
- ak sú miesta stále voľné, support vidí akciu „Obnoviť a predať“, inak sa automaticky vytvorí refund 25,00 € na IBAN protiúčtu;
- žiadne automatické vydanie vstupeniek.

*(Starý systém: platba ostane nespárovaná, rieši sa ručne.)*

### T6 – Storno po spárovaní
1. Objednávka `15501234` je `paid` (T1).
2. Operátor vytvorí refund celej objednávky so servisným poplatkom 1,00 €.
3. Export dávky SEPA; na výpise sa objaví −24,00 EUR, VS `0015501234`.

**Očakávané:**
- vstupenky stornované (uvoľnené, zneplatnené čiarové kódy);
- refund `exported` → po spárovaní odchádzajúcej transakcie `confirmed`;
- účtovne storno v rovnakom / inom mesiaci podľa dátumu predaja;
- e-mail zákazníkovi o vrátení;
- zostava „spracované refundy bez záporného pohybu“ je prázdna.

### T7 – Platba bez VS a oprava VS
1. Transakcia +25,00 EUR bez VS, popis „vstupenky 15501234“.

**Očakávané:**
- systém navrhne objednávku podľa čísla v popise (confidence nižšia) → `needs_review`;
- support potvrdí a vznikne párovanie `decided_by = user` + auditný záznam;
- objednávka `paid`.

### T8 – Chargeback karty
1. Brána pošle chargeback −25,00 EUR k pôvodnej transakcii (TID).

**Očakávané:**
- záporná transakcia spárovaná na objednávku podľa TID;
- objednávka `chargeback` a vstupenky zablokované;
- upozornenie supportu.

### T9 – Podvrhnuté e-mailové avízo
1. Do schránky príde e-mail s odosielateľom `…@csob.sk`, ale bez platného DKIM, s VS `0015501234` a sumou 25,00 €.

**Očakávané:** e-mail zamietnutý (`ignored`, dôvod `dkim_fail`), objednávka sa nedokončí, bezpečnostné upozornenie.

### T10 – Výpadok API banky
1. Fio API vráti chybu 5xx trikrát po sebe.

**Očakávané:**
- `job_runs` so stavom `failed` a chybou;
- ďalší beh zopakuje sťahovanie s prekrývajúcim sa oknom;
- po N zlyhaniach upozornenie;
- žiadne čiastočné ani duplicitné záznamy.

### T11 – Mesačné účtovné párovanie
1. Nahraj camt.053 za marec s pohybmi z príkladu v 3.7.
2. Spusti automatické priradenie.

**Očakávané:**
- +27,70 € → typ 11;
- −0,95 € → typ 21;
- −25,00 € v apríli → typ 16;
- kontrola zostatkov „počiatočný + kredity − debety − poplatky = koncový“ prejde;
- export camt.053 je validný voči XSD.

---

## 10. Otvorené body – kde doplniť

| Neoverené | Kde doplniť |
|---|---|
| Logika `GetPaymentRecoveryList` (vrátane označenia spracovaných riadkov v `basket_recovery`), `SetUnprocessedPayment`, `CheckOMSale`, `CancelOMReservation`, `CancelOMSale`, `GetBankAccount`, `AddCardpayStatement`, `GetBankStatementCardpayByTID`, `GetRefundDetail`, `ExpensesToBasket`, `UpdateSeatRC`. Overené sú iba `AddBankStatement`, `PaymentRecovery`, `GetUnprocessedPayments` a `FinalizeOMSale`. | `SHOW CREATE PROCEDURE …` (read-only) |
| DDL tabuliek predaja v DB nájomcu (`seat`, `seat_note`, `invoice`, `payment`, `to_sale`, `to_sale_recovery`, `basket_serialization`, `reservation`, `online_payment`); kto zapisuje `bank_statement.processed`, `id_seat_note`, `payme`, `refunded`, `other_payments`. Tabuľky `mt_payments.*` sú overené. | `SHOW CREATE TABLE`, `SHOW TRIGGERS FROM mt_payments`, telo `SetUnprocessedPayment` a procedúr cronu `payMe` |
| Obsah číselníka `acc_movement_type` (typy 1, 30–38, 40, 42, 43, 46 a či existuje ID 0) – dodaný dump obsahuje iba štruktúru, `seat_status` je overený | `SELECT * FROM mt_payments.acc_movement_type` |
| Produkčná hodnota `AUTO_INCREMENT` tabuliek `mt_payments.basket` a `basket_recovery`, typ `to_sale.id_basket`, a či sa čísla košíkov prideľujú z `mt_payments.basket`. Hrozí pretečenie parametra `FinalizeOMSale.IdBasket` (MEDIUMINT, max. 16 777 215; dev dump: 16 114 953) a kľúča `basket_recovery.id_basket_recovery` (SMALLINT, max. 65 535; dev dump: 32 284). | na produkcii (read-only): `SELECT TABLE_NAME, AUTO_INCREMENT FROM information_schema.TABLES WHERE TABLE_SCHEMA = 'mt_payments' AND TABLE_NAME IN ('basket', 'basket_recovery')`; telo `CheckOMSale` |
| Frekvencie cronov a či beží viac inštancií naraz | repozitár `MaxiTicket/scheduler`, k8s CronJob manifesty |
| Či je `seat_note.id_basket` vždy rovné číslu košíka pre bránu (`CheckOMSale.IdBasket`) | telo `CheckOMSale`, kontrola dát |
| Význam `payment.enabled` a zoznam aktívnych platobných metód na prostredie | `SELECT id_payment, name, psp_class, enabled FROM payment` |
| Obchodné pravidlá pre preplatok (vrátiť / ponechať / kredit) a doplatok | rozhodnutie biznisu (finance, support) |
| Poplatky brán (Comgate, GoPay, Cardpay provízia) – či ich účtovníctvo potrebuje po položkách | účtovník |
| Formát mesačných súborov po zmenách bánk (VÚB ABO import je dnes nefunkčný) | vzorky súborov od účtovníka (anonymizované) |
