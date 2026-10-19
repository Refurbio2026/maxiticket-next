# Záloha databázy

Stav k **30. 9. 2026**. Dovtedy sa nezálohovalo automaticky vôbec — najnovší
výpis bol z 2. 9.

## Čo beží

| | |
|---|---|
| Kedy | každú noc **3:20** (cron používateľa `patrikvv`) |
| Čím | `scripts/zaloha-cron.sh` → `scripts/zaloha-db.mjs` |
| Kam | `/opt/maxiticket/backup/<RRRRMMDD-HHMM>/`, práva 700, súbory 600 |
| Koľko | drží **14** posledných behov (`ZALOHA_KEEP`) |
| Log | `/opt/maxiticket/logs/zaloha.log` (sám sa drží pod 2 MB) |
| Veľkosť | ~3,8 MB na beh, ~8 s |

Jeden beh = jedna transakcia `repeatable read`, takže všetky súbory
zodpovedajú tomu istému okamihu. Každá tabuľka je jeden `.jsonl.gz`
(riadok = záznam) a v `manifest.json` je počet riadkov, posledná prehraná
migrácia a **poradie vkladania** rešpektujúce cudzie kľúče.

## Čo v zálohe nie je — a prečo

- **Zrkadlo starého systému** (`om_tickets`, `om_orders`, `om_events`,
  `om_persons`, `om_scans`, `om_seat_history`, `om_storno_log`, `om_refunds`,
  `om_seat_status`, `om_reconcile_log`). Je to 150 MB z 205 a sync ho natiahne
  znova. **Ľudské rozhodnutia áno:** `om_event_map`, `om_promoter_map`
  a naše skeny `om_ticket_scans` sa zálohujú — tie by sync neobnovil.
- **Logy** `job_runs` a `rate_limits`.
- **Schéma.** Tá je v `supabase/migrations` v gite; preto si manifest zapisuje
  verziu poslednej migrácie, aby bolo jasné, ku ktorému stavu dáta patria.
- **Hashe hesiel z `auth.users`.** Hashy nechcem v súbore na tom istom disku.
  **Metadáta účtov ale od 19. 10. 2026 v zálohe sú** —
  `auth_users_metadata.jsonl.gz`: `id`, e-mail, telefón, potvrdenia, posledné
  prihlásenie, `raw_*_meta_data`, časy. Žiadne heslá ani tokeny.
  Dôvod je tvrdý: **41 cudzích kľúčov v `public` mieria na `auth.users`**,
  takže bez účtov s **pôvodnými `id`** sa naše tabuľky nedajú vložiť vôbec.
  Účty sa obnovia cez Admin API s tými istými `id` a ľudia si heslo nastavia
  resetom. Aplikačná časť (`profiles`, `user_roles`) v zálohe bola vždy.

Nová tabuľka sa zálohuje automaticky — zoznam je „všetko okrem", nie výpočet.

## Obnova

1. Na čistú databázu prehrať migrácie z gitu do verzie, ktorú hlási
   `manifest.json` (`posledna_migracia`).
2. **Najprv účty, až potom dáta.** Z `auth_users_metadata.jsonl.gz` vytvoriť
   používateľov cez Admin API **s pôvodnými `id`**. Bez toho padne 41 cudzích
   kľúčov. Heslá sa neobnovujú — ľudia si ich nastavia resetom.
3. Vkladať tabuľky v poradí `poradie_vkladania` z manifestu. Súbory sú
   `.jsonl.gz`, takže napr.:
   `zcat orders.jsonl.gz | <vlož po riadkoch do public.orders>`.

Obnova je **vedome ručná** — skript na prepísanie ostrej databázy na jeden
príkaz by bol nebezpečnejší než užitočný.

## Kópia mimo stroja

Po každej nočnej zálohe sa celý priečinok zabalí do `.tar.gz` a nahrá do
**súkromného** bucketu `zalohy` v Supabase (`scripts/zaloha-mimo.mjs`, volá
ho `zaloha-cron.sh`). Drží sa rovnakých 14 behov ako lokálne, nahranie sa
overuje porovnaním veľkosti a zlyhanie kópie neruší zálohu samu.

Pozor na hranice: je to **ten istý poskytovateľ**, kde beží databáza. Chráni
pred stratou tohto servera, nie pred stratou účtu v Supabase. Tretie miesto
mimo Supabase je stále otvorené.

## Overenie

`scripts/skuska-obnovy.mjs` zálohu naozaj **nahrá** — do dočasných tabuliek
založených podľa ostrých (`create temp table ... like public.<t>`), v jednej
transakcii, ktorá sa na konci vráti. Sú to skutočné tabuľky so skutočnými
typmi a CHECK podmienkami, takže zlý typ, neznámy enum či NULL v nenullovom
stĺpci spadnú rovnako ako pri ostrej obnove, a v ostrej databáze nezostane nič.
Kontroluje počty (súbor vs. manifest vs. živá databáza), platnosť JSON,
jednostĺpcové cudzie kľúče medzi obnovenými tabuľkami a vzorku po poliach.

Overené 19. 10. 2026 na zálohe `20261019-0320`: **6 440 riadkov v 62
tabuľkách za 14 s, 63 cudzích kľúčov bez osirelých hodnôt, nula nesúladov**;
vzorka sedí v `orders` (51 polí), `tickets` (15), `profiles` (33), `events`
(27). To isté prešlo aj na kópii **stiahnutej zo Supabase**, takže kópia mimo
stroja je dokázateľne obnoviteľná, nie len nahraná.

Vkladá sa po dávkach do 1,5 MB: prvý pokus zamrzol na `venue_layouts` — 518
riadkov, ale po rozbalení 48 MB máp sedadiel poslaných ako jeden dotaz.

## Čo ešte nie je vyriešené

- **Tretie miesto mimo Supabase.** Kópia mimo stroja už existuje, ale u toho
  istého poskytovateľa, kde beží databáza.
- **Záloha Supabase nie je overená.** Metadáta účtov máme, hashe hesiel nie —
  takže po úplnej strate projektu si všetci nastavia heslo nanovo. Či vlastná
  záloha Supabase obsahuje aj hashe a dá sa z nej obnoviť, nikto neskúšal.
- **Obnova na skutočne čistú databázu** stále nebola. Skúška obnovy ide do
  dočasných tabuliek, takže neoverí poradie vkladania proti naozajstným
  cudzím kľúčom ani prehranie migrácií od nuly. Na to treba vedľajšiu
  databázu — na tomto stroji nie je serverový Postgres ani Docker.

Vyriešené 19. 10. 2026: kópia mimo stroja, metadáta účtov v zálohe, skúška
obnovy v repozitári a obnovená záloha tajomstiev (`.env` z 19. 10. nahradil
výpis z 12. 8., ktorému chýbal Resend aj GoPay).
