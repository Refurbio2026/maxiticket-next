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
- **`auth.users`** vrátane hashov hesiel. Nechcem hashy hesiel v súbore na tom
  istom disku; obnova účtov stojí na zálohe Supabase. Aplikačná časť
  (`profiles`, `user_roles`) v zálohe je.

Nová tabuľka sa zálohuje automaticky — zoznam je „všetko okrem", nie výpočet.

## Obnova

1. Na čistú databázu prehrať migrácie z gitu do verzie, ktorú hlási
   `manifest.json` (`posledna_migracia`).
2. Vkladať tabuľky v poradí `poradie_vkladania` z manifestu. Súbory sú
   `.jsonl.gz`, takže napr.:
   `zcat orders.jsonl.gz | <vlož po riadkoch do public.orders>`.
3. Účty doplniť zo zálohy Supabase (pozri vyššie).

Obnova je **vedome ručná** — skript na prepísanie ostrej databázy na jeden
príkaz by bol nebezpečnejší než užitočný.

## Overenie

Záloha sa dá skontrolovať proti živej databáze: počty riadkov v súbore vs.
manifest vs. databáza, platnosť JSON a zhoda jednej vzorky po poliach. Takto
bola overená prvá záloha (2. 10. 2026, 61 tabuliek, 6 400 riadkov, nula
nesúladov). Skript na to žije v scratchpade sedenia, nie v repozitári — ak ho
treba znova, je to ~60 riadkov nad `manifest.json`.

## Čo ešte nie je vyriešené

- Záloha leží **na tom istom stroji** ako databáza je v cloude, takže chráni
  pred omylom v dátach, nie pred stratou servera. Kópia mimo (napr. ku
  Patrikovi alebo do iného úložiska) je ďalší krok.
- Záloha tajomstiev (`/opt/maxiticket/secrets-backup/`) je z 12. 8. a je
  staršia než dnešný `.env` (medzitým pribudol Resend a GoPay).
