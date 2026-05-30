# Apple Wallet + Google Wallet — návrh úprav

Plnú integráciu nedokážem postaviť za jeden krok, lebo Apple a Google vyžadujú reálne certifikáty/credentials a niektoré veci (PKCS#7 podpis pre .pkpass) majú obmedzenia na Cloudflare Workers. Navrhujem 3 fázy — Fázu 1 spravím hneď, Fázy 2 a 3 keď dodáš credentials.

## Fáza 1 — UI, DB a admin scaffold (spravím teraz, bez credentials)

**Databáza (Supabase migrácia)**
- Tabuľka `tickets`: `id`, `order_id`, `event_id`, `attendee_name`, `attendee_email`, `qr_code`, `seat_label`, `section`, `row_label`, `seat_number`, `wallet_pass_url`, `google_wallet_url`, `pdf_url`, `status` (`valid` / `used` / `cancelled` / `refunded`), `created_at`, `updated_at`
- Tabuľka `wallet_settings` (jednorádová konfigurácia pre admina): Apple Pass Type ID, Team ID, status certifikátov; Google Issuer ID, status service accountu
- RLS: vstupenky vidí len vlastník (cez email z objednávky alebo prihlásený user), admin vidí všetko

**Success stránka `/checkout/success/[orderId]`**
- Veľké CTA hore: „Pridajte si vstupenku do mobilu"
- Pod každým QR kódom 4 tlačidlá:
  - Apple Wallet (čierne s Apple logom)
  - Google Wallet (oficiálny Google badge)
  - Stiahnuť PDF
  - Poslať na email
- Keď credentials chýbajú, Wallet tlačidlá zobrazia toast „Wallet zatiaľ nie je nakonfigurovaný" namiesto crashu

**Sekcia „Moje vstupenky" v `/account`**
- Zoznam vstupeniek pre prihláseného usera (alebo overený email)
- Pri každej: QR, dátum, miesto, sektor/rad/sedadlo + 4 akčné tlačidlá

**Admin `/admin/system/wallet`**
- Apple Wallet panel: pole pre Pass Type ID, Team ID, indikátor či sú nahraté certifikáty (samotné `.p12` súbory sa uploadnú cez Secrets, nie do DB)
- Google Wallet panel: Issuer ID, indikátor že je nahraný service account
- Test tlačidlo „Vygeneruj testovací pass"

**Server functions (skeleton)**
- `generateApplePass(ticketId)` — vráti URL na `.pkpass` alebo „not configured"
- `generateGoogleWalletLink(ticketId)` — vráti `https://pay.google.com/gp/v/save/<jwt>` alebo „not configured"
- `sendTicketEmail(orderId)` — pripravený endpoint, zatiaľ vracia success toast

**Otázka na rozhodnutie pred fázou 1:**
Sekcia „Moje vstupenky" potrebuje identifikovať usera. Aktuálne projekt nemá zapnuté prihlásenie pre zákazníkov. Vyber jednu cestu:
- **(A) Zapnúť auth (email+heslo)** — správna produkčná cesta, vstupenky viazané na účet
- **(B) Overenie cez email z objednávky** — user zadá email použitý pri nákupe, dostane prístup; jednoduchšie pre demo
- **(C) Vynechať „Moje vstupenky"** zatiaľ, len success stránka + admin

## Fáza 2 — Google Wallet naživo (technicky jednoduchšie)

Po dodaní credentials:
- **Potrebné secrets:** `GOOGLE_WALLET_ISSUER_ID`, `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON`
- Server fn vytvorí EventTicket Class (raz pre podujatie) a EventTicket Object (pre každú vstupenku) cez Google Wallet API
- Vygeneruje JWT podpísaný RS256 service account kľúčom
- Vráti link `https://pay.google.com/gp/v/save/<jwt>` — funguje na Androide aj iPhone (cez prehliadač)
- Postavím to ako prvé, lebo netreba špeciálny podpis ani Apple účet

## Fáza 3 — Apple Wallet naživo

**Potrebné od teba:**
- Apple Developer účet ($99/rok)
- Pass Type ID certifikát (export z Keychainu ako `.p12`, prevedený na base64)
- Apple WWDR G4 certifikát (base64)
- Team Identifier (string z developer.apple.com)
- Pass Type Identifier (napr. `pass.com.maxiticket.event`)

**Technické rozhodnutie:** Cloudflare Workers nemajú plnú podporu pre PKCS#7. Dve cesty:
- **(A) Externá služba** (napr. PassKit.com alebo Walletpasses.io) — outsourcujeme podpis, my len pošleme JSON. Najrýchlejšie.
- **(B) Vlastná podpisovacia služba** (mini Node.js worker na Railway/Render len pre .pkpass podpis cez `node-forge`). Plná kontrola, nákladnejšie na údržbu.

Rozhodneme keď budeme vo Fáze 3.

## Fáza 4 — Budúce funkcie (podľa tvojho zoznamu, pripravené v architektúre)

- **Push aktualizácie:** Apple Wallet web service endpoint `/api/public/wallet/apple/v1/...` + Google Wallet `patch` API. Pripravím URL štruktúru už vo Fáze 1.
- **Zmena času/sektora:** server fn `updateTicket(ticketId, changes)` triggerne push do oboch peňaženiek
- **Zrušenie podujatia:** invaliduje `status='cancelled'` + pošle push
- **Upozornenia pred podujatím:** cron endpoint `/api/public/cron/notify-upcoming` (denne)

---

## Čo potrebujem od teba pred štartom Fázy 1

1. **Auth varianta pre „Moje vstupenky"** — A, B alebo C (vyššie)
2. **Potvrdenie** že môžem vytvoriť tabuľky `tickets` a `wallet_settings` v Lovable Cloud

Akonáhle odpovieš, spustím Fázu 1 (UI + DB + admin scaffold). Fázy 2/3 začnem keď budeš mať credentials pripravené.
