# Integrácia starého systému (OM) — stav a čo ďalej

Stav k **18. 9. 2026**. Dokument je handover: čo je hotové, čo beží, čo čaká
na rozhodnutie a na čo si dať pozor. Prevádzkový návod je v
[`scripts/sync-om/README.md`](../scripts/sync-om/README.md), špecifikácia zdroja
v [`spec-ticket-sync.md`](spec-ticket-sync.md).

## Kde to stojí

**Hotové, nasadené a beží:**

- Sync z produkčného RDS starého systému do Supabase — 9 kanálov v cron-e
  používateľa `patrikvv`, logy v `/var/log/om-sync/`, logrotate nastavený.
- Staging tabuľky `om_*`, pohľady `tickets_unified`, `om_predaj_prehlad`,
  `om_mapovanie_prehlad`, `om_posledny_sken`.
- Admin stránka **eticketo.eu → Starý systém** (`/admin/eticketo/om-predaj`):
  prehľad celého starého predaja + potvrdzovanie väzieb.
- Skener prijíma staré vstupenky (`src/lib/om-scan.server.ts`), ale až po
  potvrdení väzby.
- Aplikácia nasadená 18. 9. 09:27, PM2 bez chýb.

**Čísla (18. 9.):** 840 podujatí · 64 550 predaných vstupeniek · 891 634 € s DPH ·
437 organizátorov · Supabase 157 MB pri limite 4000 MB.

## Čo čaká ako prvé

**Potvrdiť 142 návrhov väzieb.** Všetky majú istotu 0,95 (zhoda názvu, dátumu
aj času). Kým nie je potvrdená ani jedna, **skener starú vstupenku neprijme** —
je to zámer, nie chyba. Po potvrdení bude skenovateľných 6 344 starých vstupeniek.

Potvrdzuje sa v admine po jednom. Odporúčanie: potvrdiť najprv jedno podujatie,
na ktorom sú čoskoro dvere, vyskúšať skener naživo a až potom zvyšok.

**Predaje stále ukazujú len naše objednávky** (92 ks, posledná 1. 9.). Napojenie
na zjednotený pohľad je ďalší krok — `tickets_unified` aj `om_predaj_prehlad`
sú pripravené, žiadna stránka ich zatiaľ nečíta okrem novej.

## Rozhodnutia, ktoré blokujú zvyšok

1. **Dokedy má starý systém predávať?** Stále predáva — 18. 9. pribudlo 160
   predaných vstupeniek. Od tohto dátumu závisí, či sa oblasti prenášajú, alebo
   len doťahujú. Bez neho je každá ďalšia úvaha špekulácia.
2. **Turnikety.** Najväčšia neprenesená oblasť: 14 tabuliek, 1,1 mil. pokusov
   o prechod, 906 tis. exportovaných vstupeniek. V starom kóde sú tri
   integrácie (Skidata, Colosseo, ITC). Treba vedieť, ktoré podujatia ich
   naozaj používajú.
3. **Newsletter** — 3,2 mil. riadkov kontaktov. Otázka je skôr právna (súhlasy)
   než technická.
4. **Permanentky (ABO)** majú v OM 249 riadkov, čiže ich prakticky nikto
   nepoužíva. Návrh: vynechať.

## Architektúra — čo je rozhodnuté a prečo

**Jeden systém zapisuje, druhý sa len číta.** Do OM sa nezapisuje nikdy: účet
`eticketo_sync` má iba `GRANT SELECT`, worker navyše prepína každé spojenie do
`SET SESSION TRANSACTION READ ONLY`.

**Zápis do oboch databáz naraz sa robiť nebude.** Rezerváciu sedadla drží
atomická `reserve_seats()`; cez dve databázy bez spoločnej transakcie sa
atomická byť nedá a to isté sedadlo by sa predalo dvakrát.

**OM dáta sa nekopírujú do `orders` a `tickets`.** Naše tabuľky stoja na
`organizer_id` v RLS, na HMAC podpísaných QR, na `claim_order_paid`
a `issue_tickets`. Cudzie riadky by tie záruky ticho porušili.

**Prehľad starého predaja nefiltruje podľa väzby na eticketo.** 87 % starého
predaja náprotivok nemá, lebo organizátori v OM účty nemali — to je vec
eticketa, nie podmienka viditeľnosti.

## Na čo si dať pozor

- **Voľné miesta sa do `om_tickets` zámerne nevkladajú.** Výnimka: miesto,
  ktoré tam už je — to je storno. Bez tejto výnimky by storná zmizli.
- **`om_tickets.scan` prepisuje každý beh syncu.** Nič vlastné doň neukladaj;
  naše skeny sú v `om_ticket_scans`.
- **849 čiarových kódov sa v OM opakuje vo viacerých predstaveniach.** Skener
  preto hľadá výhradne v rámci podujatia, nikdy globálne.
- **`OM_DB_SIZE_LIMIT_MB` je povinná.** Bez nej worker odmietne bežať. Vzniklo
  to z incidentu 16. 9., keď backfill zaplnil disk Supabase a databáza sa
  prepla do read-only. Ak by sa to stalo znova: `truncate` neprejde bez
  `set default_transaction_read_only = off`, a po vyprázdnení treba **vynulovať
  kurzory**, inak sync považuje dáta za natiahnuté.
- **`mt_payments.basket` sa priebežne maže** (35 riadkov z jedného dňa), takže
  čas objednávky sa pre históriu berie z `MIN(seat.changed)`. Zdroj je
  zapísaný v `om_orders.raw ->> 'zdroj_casu'`.
- **`types.ts` sa dopĺňa ručne** — generátor Supabase CLI cez pooler na tomto
  serveri nebeží. `routeTree.gen.ts` generuje dev server (nie build, ten najprv
  zmaže `.output` a web by bol dole).
- **Build vždy** `NODE_OPTIONS=--max-old-space-size=3072 NITRO_PRESET=node-server bun run build`
  a po ňom skontrolovať preset. Počas buildu sa oplatí pauznúť cron — sync
  a build si na 3,9 GB stroji konkurujú o pamäť.

## Migrácie

Nasadené a zapísané v `supabase_migrations.schema_migrations`:

| Migrácia | Čo prináša |
|---|---|
| `20260916100000` | staging `om_*`, číselník stavov, klasifikačný trigger |
| `20260916100100` | `tickets_unified`, dopárovanie skenov, počty |
| `20260916100200` | zaradenie šiestich stavov, počty podľa kategórie |
| `20260918100000` | `om_event_map`, `om_promoter_map`, návrh párovania |
| `20260918100100` | `om_promoters`, `om_predaj_prehlad` |
| `20260918100200` | `om_ticket_scans`, `om_najdi_vstupenku` |
| `20260918100300` | názov nášho podujatia v prehľade |

## Prístupy

`scripts/sync-om/.env` (v `.gitignore`) drží prístupy k OM. Prístupy k Supabase
si worker číta z `/opt/maxiticket/.env` — zámerne sa nekopírujú.

Na inom stroji treba `.env` vytvoriť znova; vzor je v README.
