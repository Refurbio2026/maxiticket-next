# Sync vstupeniek zo starého systému (OM4 → Supabase)

Inkrementálna synchronizácia vstupeniek, objednávok, stornov, skenov a podujatí
z MaxiTicket OM4 (MariaDB `bt_tickets` na RDS) do našej Supabase.

- Špecifikácia zdroja: [`docs/spec-ticket-sync.md`](../../docs/spec-ticket-sync.md)
- Schéma: `supabase/migrations/20260916100000_om_staging_sync.sql`
- Pohľad a funkcie: `supabase/migrations/20260916100100_om_tickets_unified.sql`

**Do zdrojovej databázy sa nikdy nezapisuje.** Sync nemá v OM kurzory ani outbox,
produkčný účet `eticketo_sync` má len `SELECT` a každé spojenie sa navyše prepína
do read-only transakčného režimu.

## `.env`

Súbor `scripts/sync-om/.env` (je v `.gitignore`, práva 600):

```
OM_DB_HOST=maxiticket-db-rds-restored-….rds.amazonaws.com
OM_DB_USER=eticketo_sync      # na dev je to root
OM_DB_PASS=…
OM_DB_NAME=bt_tickets
```

Prístupy k Supabase sa sem **nekopírujú**. Worker si `SUPABASE_URL` a
`SUPABASE_SERVICE_ROLE_KEY` prečíta z `/opt/maxiticket/.env`, kde už sú — druhá
kópia service key je druhé miesto, odkiaľ môže uniknúť. Ak ich predsa treba
prebiť (iné prostredie), zaberú aj tu pod menami `SUPABASE_URL` a
`SUPABASE_SERVICE_KEY`.

Voliteľné:

| Premenná            | Default              | Načo                                |
| ------------------- | -------------------- | ----------------------------------- |
| `OM_DB_PORT`        | `3306`               |                                     |
| `OM_DB_CHARSET`     | `UTF8MB4_UNICODE_CI` | pozri „Kódovanie" nižšie            |
| `OM_DB_TIMEZONE`    | `Europe/Bratislava`  | zóna, v ktorej OM ukladá `datetime` |
| `OM_SYNC_LOG_LEVEL` | `info`               | `debug` vypisuje každú dávku        |

### Kódovanie — prečo utf8mb4, a nie cp1250

Tabuľky zdroja nie sú v jednom charsete: `seat` a `seat_scan` sú `cp1250`,
`storno_seat_log` je `utf8mb4`. Spojenie preto beží v **utf8mb4** — MariaDB
prekóduje cp1250 stĺpce na výstupe sama a klient dostane korektné UTF-8 z oboch
skupín. Keby spojenie bežalo v cp1250, znaky mimo tejto stránky (emoji,
typografické apostrofy) uložené v utf8mb4 tabuľkách by sa cestou ticho stratili.
Normalizuje sa až v cieli, späť do zdroja sa nezapisuje nikdy.

### Čas

OM ukladá `datetime` bez zóny, v lokálnom čase prevádzky. Worker ich číta ako
reťazce a prepočítava sám podľa `OM_DB_TIMEZONE` — automatická konverzia v mysql2
by použila zónu procesu a v lete by sa všetko posunulo o hodinu. Prechod na letný
čas je ošetrený (overené na júlovom aj januárovom dátume).

## Spustenie

```bash
node scripts/sync-om/sync-om.js --channel=A              # jeden kanál
node scripts/sync-om/sync-om.js --channel=A --dry-run    # bez zápisu
node scripts/sync-om/sync-om.js --channel=all            # všetko v poradí
node scripts/sync-om/sync-om.js --channel=A --full       # od nuly (backfill)
node scripts/sync-om/sync-om.js --help
```

`--dry-run` číta zo zdroja, všetko zmapuje, ale **nezapíše a neposunie kurzor** —
skúšobný beh nesmie preskočiť dáta ostrému. Neberie ani zámok, takže nezablokuje
bežiaci cron.

`--max-batches=N` obmedzí počet dávok; hodí sa na prvé pozretie do veľkej tabuľky.

### `--since=YYYY-MM-DD`

Oreže sync na podujatia od dátumu (`plan.datum >= since`). Produkčná `seat` má
desiatky miliónov riadkov a drvivá väčšina patrí odohraným predstaveniam, ktoré
nepotrebujeme.

| Kanál     | Ako sa orezáva                                                           |
| --------- | ------------------------------------------------------------------------ |
| A         | `seat.id_plan IN (SELECT id_plan FROM plan WHERE datum >= ?)`            |
| B         | `EXISTS` cez `seat.id_seat_note` → `plan.datum` (index `id_seat_note`)   |
| C2, C3, D | cez vlastný `id_plan` (všetky tri naň index majú)                        |
| E         | `plan.datum >= ?`                                                        |
| C1        | **neorezáva sa** — `storno_seat_log` `id_plan` nemá a je to malá tabuľka |

**Hodnota sa uloží do kurzora.** Inkrementálny beh po backfille preto filtruje
rovnako a prepínač sa už nemusí opakovať; prerušený backfill sa dá dokončiť bez
neho. Zmeniť rozsah znamená spustiť kanál znovu s iným `--since` — hodnota
v kurzore sa prepíše.

Bez tohto by sa po backfille začali ťahať aj miesta starých podujatí, ktorých
históriu sme zámerne vynechali.

## Kanály

| Kanál       | Zdroj                                         | Kurzor                               | Frekvencia | Dávka |
| ----------- | --------------------------------------------- | ------------------------------------ | ---------- | ----- |
| `A`         | `seat`                                        | `(modified, id_seat)`, prekryv 5 min | 1 min      | 5 000 |
| `B`         | `seat_note` + `invoice` + `person` + `basket` | `id_seat_note`, prekryv 500          | 5 min      | 1 000 |
| `C1`        | `storno_seat_log`                             | `id_storno_seat_log`                 | 5 min      | 1 000 |
| `C2`        | `seat_history`                                | `id_seat_history`                    | 5 min      | 1 000 |
| `C3`        | `seat_note_refund`                            | `id` + okno na `date_refund`         | 5 min      | 1 000 |
| `D`         | `seat_scan`                                   | `id_seat_scan`, bez prekryvu         | 1 min      | 5 000 |
| `E`         | `plan`                                        | `modified`                           | 15 min     | 1 000 |
| `codebooks` | číselníky bez časovej značky                  | —                                    | denne      | —     |
| `counts`    | agregácia nad `seat`                          | —                                    | hodinovo   | —     |

Kurzory sú v `om_sync_cursor` (jeden riadok na kanál, `cursor_value` je jsonb).
Zámok proti súbehu je `job_runs` s menom `om-sync-<kanál>` — druhý súbežný beh
sa ticho preskočí.

### Čo sa do cieľa zámerne nedostane

**Voľné miesta (`category = 'free'`) sa nevkladajú.** Riadok v `seat` vzniká pre
každé miesto každého predstavenia, takže voľné sedadlá tvoria drvivú väčšinu
tabuľky — v meranej vzorke 4 884 z 5 000. Ako vstupenka nemajú hodnotu.

Výnimka, na ktorej všetko stojí: voľné miesto sa **prenesie, ak to isté `id_seat`
už v cieli je**. To je presne storno predanej vstupenky a bez neho by scenáre T3
a T4 prestali fungovať.

**`raw` sa ukladá len pre `sold`, `abo` a `pending`.** Je to celý zdrojový riadok
ako JSON aj s kľúčmi a pri blokovaných a voľných miestach z neho nikto nikdy nič
nečítal. Nie je to `NULL`, ale `{}` — `om_tickets.raw` je v migrácii `not null`.

Spolu to na meranej vzorke ubralo **97,7 %** (4 502 kB → 104 kB).

Dôsledok pre kontrolu počtov: cieľ nevie, koľko je voľných miest, lebo ich
neukladá. Dopočítava ich ako `zdroj.seats − (sold + abo + reserved + blocked +
other)`. Nezhodu preto zakladá len `sold`, `abo`, `reserved`, `blocked`
a `scanned` — `seats` a `free` sú odvodené zo zdroja a zdvojovali by rozdiel,
ktorý už hlási niektorá z ostatných kategórií.

### Poistka proti zaplneniu disku

**Pred každou dávkou** worker prečíta `pg_database_size()` a nad
`OM_DB_SIZE_LIMIT_MB` sa zastaví s chybou do `om_sync_cursor`. Kontrola je
v `upsert()`, teda na jedinom mieste, cez ktoré tečie všetko zapisované — nedá
sa obísť pridaním kanála. Veľkosť sa overuje aj na štarte.

Vzniklo to z incidentu 16. 9. 2026: backfill dev dát naplnil produkčnú databázu
z 29 MB na 982 MB, Postgres prepol do read-only a jeden backend spadol.

Veľkosť sa číta priamo cez pooler (`pg`), lebo `pg_database_size()` PostgREST
neponúka a schému kvôli tomu meniť nechceme. Potrebuje `SUPABASE_DB_PASSWORD`;
host aj používateľ sa odvodia zo `SUPABASE_URL`, prípadne ich prebije
`SUPABASE_DB_HOST` / `SUPABASE_DB_USER`.

**Keby databáza predsa prešla do read-only**, `truncate` na nej neprejde. Najprv:

```sql
set default_transaction_read_only = off;
truncate table om_tickets, om_orders, om_persons, om_seat_history,
               om_storno_log, om_refunds, om_scans, om_events, om_reconcile_log;
```

Potom **vynuluj kurzory** — inak si sync myslí, že dáta má, a už ich nedotiahne:

```sql
update om_sync_cursor set cursor_value = '{}'::jsonb, rows_processed = 0;
```

### Čo vyzerá ako chyba, ale nie je

- **Vstupenka bez objednávky je normálna.** Hlavičku `seat_note` nemá 36,7 %
  predaja (celý externý predaj, voľné vstupenky, 71 % pokladničného). Objednávka
  sa pre ne odvodzuje zo `seat` do `om_tickets.synthetic_order_key`.
- **Stav 15 „Externý predaj" s nulovou cenou je označený `suspicious`.** Nie je
  to predaj, ale zrušená rezervácia z turniketu — známa chyba v OM
  (`Triton.php:657`). Do tržby sa takéto riadky nerátajú.
- **Objem tvoria blokovania, nie predaj.** Stav 2 je 57 % všetkých zmien.
- **Premenovanie podujatia sa prejaví až v noci.** `drama` nemá v OM žiadnu
  časovú značku, mení to až denný `codebooks`.

## Prvé naplnenie (backfill)

Poradie je dôležité: číselník musí byť skôr než vstupenky (kanál A z neho
rozhoduje o odvodených objednávkach) a podujatia skôr než sa budú párovať skeny.

```bash
cd /opt/maxiticket/app

# 1. suchý beh — overí prístupy, kódovanie a mapovanie, nič nezapíše
node scripts/sync-om/sync-om.js --channel=E --dry-run --max-batches=1
node scripts/sync-om/sync-om.js --channel=A --dry-run --max-batches=1

# 2. číselníky a podujatia
node scripts/sync-om/sync-om.js --channel=codebooks
node scripts/sync-om/sync-om.js --channel=E --full --since=2026-01-01

# 3. vstupenky — najdlhší krok, beží aj hodiny; je prerušiteľný
node scripts/sync-om/sync-om.js --channel=A --full --since=2026-01-01

# 4. objednávky, udalosti, skeny
node scripts/sync-om/sync-om.js --channel=B  --full --since=2026-01-01
node scripts/sync-om/sync-om.js --channel=C1 --full
node scripts/sync-om/sync-om.js --channel=C2 --full --since=2026-01-01
node scripts/sync-om/sync-om.js --channel=C3 --full --since=2026-01-01
node scripts/sync-om/sync-om.js --channel=D  --full --since=2026-01-01

# 5. kontrola, že počty sedia
node scripts/sync-om/sync-om.js --channel=counts
```

Backfill sa dá kedykoľvek prerušiť a spustiť znovu — kurzor sa posúva po každej
dávke a upserty sú idempotentné. Po prerušení **nepoužívaj `--full`**, inak sa
začne odznova; bez neho pokračuje od kurzora, aj s uloženým `--since`.

Až keď backfill dobehne, zapni cron.

## Cron (VM 104)

```cron
# Sync zo starého systému (OM4). Log: /var/log/om-sync/
*/1  * * * *  cd /opt/maxiticket/app && node scripts/sync-om/sync-om.js --channel=A >> /var/log/om-sync/a.log 2>&1
*/1  * * * *  cd /opt/maxiticket/app && node scripts/sync-om/sync-om.js --channel=D >> /var/log/om-sync/d.log 2>&1
*/5  * * * *  cd /opt/maxiticket/app && node scripts/sync-om/sync-om.js --channel=B >> /var/log/om-sync/b.log 2>&1
*/5  * * * *  cd /opt/maxiticket/app && node scripts/sync-om/sync-om.js --channel=C1 >> /var/log/om-sync/c.log 2>&1
*/5  * * * *  cd /opt/maxiticket/app && node scripts/sync-om/sync-om.js --channel=C2 >> /var/log/om-sync/c.log 2>&1
*/5  * * * *  cd /opt/maxiticket/app && node scripts/sync-om/sync-om.js --channel=C3 >> /var/log/om-sync/c.log 2>&1
*/15 * * * *  cd /opt/maxiticket/app && node scripts/sync-om/sync-om.js --channel=E >> /var/log/om-sync/e.log 2>&1
17   * * * *  cd /opt/maxiticket/app && node scripts/sync-om/sync-om.js --channel=counts >> /var/log/om-sync/counts.log 2>&1
40   3 * * *  cd /opt/maxiticket/app && node scripts/sync-om/sync-om.js --channel=codebooks >> /var/log/om-sync/codebooks.log 2>&1
```

Príprava:

```bash
sudo mkdir -p /var/log/om-sync && sudo chown "$USER" /var/log/om-sync
```

Poznámky:

- Minútové kanály sa neprekrývajú samy so sebou — keď beh trvá dlhšie než minútu,
  ďalší sa cez `job_runs` preskočí a v logu je `preskočené, kanál už beží`.
- Kontrola počtov je zámerne na `:17`, nie na celú hodinu — nech nesúperí
  s ostatnými úlohami servera.
- Číselníky idú v noci, lebo je to plný refresh.
- Rotáciu logov nastav cez `logrotate`; worker si ju nerieši.

## Kde hľadať, keď niečo nesedí

```sql
-- stav kanálov: kedy naposledy, koľko riadkov, s akou chybou
select channel, last_run_at, last_success_at, rows_processed, last_error
  from om_sync_cursor order by channel;

-- behy vrátane zlyhaní
select job, started_at, status, stats, error
  from job_runs where job like 'om-sync-%' order by started_at desc limit 20;

-- nezhody počtov a zmiznuté predstavenia
select * from om_reconcile_log where status <> 'ok' order by checked_at desc limit 20;

-- riadky na kontrolu prevádzkou (stav 15)
select id_plan, count(*) from om_tickets where suspicious group by id_plan order by 2 desc;

-- skeny, ktoré sa nepodarilo dopárovať na vstupenku
select unmatched_reason, count(*) from om_scans where matched_id_seat is null group by 1;

-- nové stavy, ktoré čakajú na ručné zaradenie
select id_seat_status, name, category from om_seat_status where category_source = 'auto';

-- aké orezanie má kanál uložené
select channel, cursor_value ->> 'since' from om_sync_cursor;

-- veľkosť cieľovej databázy oproti limitu
select pg_size_pretty(pg_database_size(current_database()));
```

Zjednotený zoznam vstupeniek (staré aj naše) je view `tickets_unified`.

## Testy

```bash
node --test "scripts/sync-om/tests/*.test.js"
```

Pokrývajú scenáre T1–T10 zo špecifikácie proti fixture dátam. Na starý systém
sa nepripájajú vôbec.

Scenáre, ktoré sa rozhodujú v SQL (poradie skenov podľa `scan_time`, idempotencia
upsertu, kontrola počtov), bežia proti Supabase v transakcii ukončenej `ROLLBACK`
— v databáze po nich nezostane nič. Bez `SUPABASE_DB_PASSWORD` sa **preskočia**
(`# skipped`), nie prejdú.
