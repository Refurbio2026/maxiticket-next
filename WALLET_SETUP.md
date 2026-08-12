# Digitálne peňaženky (Apple Wallet + Google Wallet) — nastavenie

Tento dokument popisuje, čo treba spraviť, aby vstupenky reálne pribudli do
mobilnej peňaženky. Kód je pripravený — chýbajú už len prístupové údaje, ktoré
vieš získať len ty (sú viazané na tvoju firmu / Apple + Google účet).

---

## Google Wallet — funkčné hneď po pridaní 2 kľúčov

Kód generovania je hotový (`src/lib/google-wallet.server.ts` +
`src/lib/wallet.functions.ts`). Zapne sa automaticky, keď pridáš tieto tajné
kľúče (Secrets) v projekte:

| Secret                                    | Odkiaľ ho vezmeš                                         |
| ----------------------------------------- | -------------------------------------------------------- |
| `GOOGLE_WALLET_ISSUER_ID`                 | číslo vydavateľa z Google Wallet konzoly                 |
| `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON`      | celý JSON súbor service accountu (vlož ako jeden riadok) |
| `GOOGLE_WALLET_ISSUER_NAME` _(nepovinné)_ | názov, ktorý sa zobrazí v peňaženke (napr. „MaxiTicket") |

### Postup krok za krokom

1. **Issuer účet** — choď na https://pay.google.com/business/console, požiadaj
   o prístup k **Google Wallet API**. Po schválení dostaneš **Issuer ID**
   (dlhé číslo, napr. `3388000000022…`). Schválenie zvykne trvať 1–3 dni.
2. **Google Cloud projekt** — na https://console.cloud.google.com vytvor projekt
   a v „APIs & Services" zapni **Google Wallet API**.
3. **Service account** — v „IAM & Admin → Service Accounts" vytvor service
   account, potom mu vytvor **kľúč typu JSON** a stiahni ho.
4. **Prepojenie** — v Google Wallet konzole (bod 1) pridaj email service
   accountu ako používateľa s prístupom k Issuer účtu.
5. **Kľúče do projektu** — v nastaveniach projektu (Secrets / Environment
   variables) pridaj `GOOGLE_WALLET_ISSUER_ID` a
   `GOOGLE_WALLET_SERVICE_ACCOUNT_JSON` (celý obsah stiahnutého JSON súboru).
6. **Redeploy** — po nasadení tlačidlo „Pridať do Google Wallet" začne
   generovať reálny odkaz.

> Poznámka: kým je trieda vstupenky v stave `UNDER_REVIEW`, funguje pre tvoj
> vlastný Issuer účet. Pre plnú verejnú produkciu sa trieda raz odošle Googlu
> na schválenie (v konzole).

Bez týchto kľúčov tlačidlo nespadne — zobrazí slušnú hlášku
„Google Wallet zatiaľ nie je nakonfigurovaný".

---

## Apple Wallet — potrebuje Apple Developer účet

Apple Wallet je náročnejší: `.pkpass` súbor sa musí kryptograficky podpísať
(PKCS#7) certifikátom od Apple. To sa dá naprogramovať a otestovať až s reálnymi
certifikátmi na reálnom zariadení. Aktuálne tlačidlo „Apple Wallet" slušne
oznámi, že funkcia zatiaľ nie je nakonfigurovaná (nič nespadne).

### Čo od teba budem potrebovať, aby som to dokončil naostro

1. **Apple Developer Program** — členstvo (99 $/rok) na https://developer.apple.com
2. **Pass Type ID** — vytvoríš v Apple Developer portáli (napr. `pass.sk.maxiticket.event`)
3. **Pass Type ID certifikát** — vygenerovaný `.p12` súbor + jeho heslo
4. **Apple WWDR certifikát** (G4) — verejne stiahnuteľný z Apple
5. **Team Identifier** — 10-znakový reťazec z Apple Developer účtu

Keď toto budeš mať, doplní sa kód pre podpis `.pkpass`, tajné kľúče
`APPLE_WALLET_*` a endpoint, ktorý vstupenku vygeneruje a stiahne do Apple
Wallet — a otestujeme to na iPhone.

---

## Zhrnutie stavu

- **Google Wallet:** kód hotový ✅ — čaká len na Issuer ID + service account JSON.
- **Apple Wallet:** UI hotové, generovanie sa dorobí po získaní Apple certifikátov.
- **Stránka po nákupe aj „Môj účet":** tlačidlá Apple/Google Wallet, PDF a QR sú funkčné.
