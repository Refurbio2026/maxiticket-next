# Vstupenka v peňaženke (Apple Wallet a Google Wallet)

Zákazník má pri vstupenke dve tlačidlá — v účte (`/account`) aj na stránke po
nákupe. Obe sú zapojené; chýbajú už len prístupy od Apple a od Google.

## Ako to funguje

| | Apple Wallet | Google Wallet |
|---|---|---|
| Čo sa zákazníkovi pošle | podpísaný súbor `.pkpass` | odkaz „Save to Google Wallet" (podpísaný JWT) |
| Kde sa to tvorí | `src/lib/wallet/apple-wallet.server.ts` | `src/lib/google-wallet.server.ts` |
| Routa | `GET /api/public/tickets/<id>.pkpass?t=…` | odkaz vracia serverová funkcia |
| Podpis | PKCS#7 odpojený, DER (openssl) | RS256 JWT (service account) |

**Autorizácia je u oboch rovnaká:** volajúci musí poznať **podpísaný QR token**
vstupenky (`MT2.<id>.<podpis>`). Routa s `.pkpass` si prístup overuje ešte raz
podpísaným tokenom objednávky (`verifyOrderAccess`), a to proti objednávke,
ktorej tá vstupenka naozaj patrí — inak by token k jednej objednávke otvoril
vstupenky z inej. Refundovaná alebo nezaplatená vstupenka sa do peňaženky
nedostane.

Pass sa **nikde neukladá** — skladá a podpisuje sa pri každom stiahnutí, takže
sa nedá vytiahnuť z disku ani z databázy. Certifikát a kľúč idú do priečinka
s právami 700 a hneď po podpise sa maže celý; heslo ku kľúču sa openssl predáva
cez premennú prostredia, nie ako argument (argumenty sú viditeľné v `ps`).

## Čo treba doplniť

### Apple Wallet

Toto sa nedá obísť ani vygenerovať: Wallet neprijme pass, ktorý nie je
podpísaný certifikátom priradeným k danému `passTypeIdentifier`.

1. Členstvo v **Apple Developer Program** (99 USD/rok).
2. V Apple Developer portáli vytvoriť **Pass Type ID** (napr.
   `pass.eu.eticketo.vstupenka`) a k nemu **certifikát**.
3. Z Keychainu vyexportovať certifikát **aj s privátnym kľúčom** do PEM.
4. Stiahnuť medzičlánok **Apple WWDR** (tiež PEM).
5. Do `wallet_settings` (Systém → Wallet) doplniť Pass Type ID, Team ID
   a názov organizácie, a zapnúť Apple.
6. Certifikáty na server:

```
APPLE_WALLET_CERT_FILE=/opt/maxiticket/secrets/apple-pass.pem
APPLE_WALLET_WWDR_FILE=/opt/maxiticket/secrets/apple-wwdr.pem
APPLE_WALLET_CERT_PASSPHRASE=…        # len ak je kľúč zašifrovaný
```

PEM sa dá dať aj do prístupov v databáze (`APPLE_WALLET_CERT`,
`APPLE_WALLET_WWDR`), ale privátny kľúč je lepšie držať na disku.

### Google Wallet

1. Projekt v Google Cloud, povolené **Google Wallet API**.
2. **Service account** a jeho JSON kľúč.
3. Konto v Google Pay & Wallet Console → **Issuer ID**, a service account
   pridať ako autorizovaného vydavateľa.
4. Do `.env`:

```
GOOGLE_WALLET_ISSUER_ID=3388000000022…
GOOGLE_WALLET_SERVICE_ACCOUNT_JSON={"client_email":"…","private_key":"…"}
GOOGLE_WALLET_ISSUER_NAME=eticketo.eu
```

Kým chýbajú, tlačidlo povie zákazníkovi po ľudsky, že to zatiaľ nie je
zapnuté, a odkáže ho na e-mail a PDF. Čo presne chýba, ide do logu pre
admina — nie zákazníkovi.

## Čo je overené

Generátor `.pkpass` je **otestovaný naživo vlastným certifikátom** (19. 10.
2026 / 23. 10. 2026):

- výsledok je platný ZIP so šiestimi súbormi (`pass.json`, `icon.png`,
  `icon@2x.png`, `logo.png`, `manifest.json`, `signature`),
- `manifest.json` sedí so SHA-1 **každého** súboru,
- v `pass.json` je náš podpísaný `MT2` token v kódovaní `iso-8859-1`,
- podpis je platný PKCS#7 a `openssl smime -verify` ho prijal
  („Verification successful"),
- pass má 11 kB.

Čiže keď pribudne certifikát od Apple, nemení sa nič iné než ten súbor.

K tomu 19 unit testov v `pkpass.test.ts`: kontrolné hodnoty CRC-32, štruktúra
ZIP-u (podpisy hlavičiek, počet záznamov, posun centrálneho registra, metóda
„bez kompresie", determinizmus), SHA-1 manifest, a `pass.json` — že QR je náš
token v predpísanom kódovaní, že prázdne polia sa vynechajú a že dlhý názov
podujatia neprekročí povolenú dĺžku popisu.

## Prečo ZIP vlastný a openssl namiesto balíka

Balík na `.pkpass` ani na ZIP v projekte nie je a pre pár kB textu a dve PNG je
kompresia bezpredmetná — ukladanie bez kompresie je platný ZIP. Podpis je
PKCS#7 odpojený v DER, čo node natívne nevie; `openssl` je na stroji a projekt
rovnako rieši aj kľúče GP webpay. Žiadna nová závislosť.

Časy v ZIP-e sú zámerne pevné, takže rovnaký vstup dá rovnaký výstup a pass sa
dá porovnať.

## Čo by sa dalo pridať

- **Aktualizácia passu** po zmene podujatia (`webServiceURL` + push). Dnes je
  pass statický: keď sa podujatie presunie, zákazník si musí stiahnuť nový.
- Logo organizátora namiesto nášho na `logo.png`.
- `locations` v passe, aby sa vstupenka ukázala na uzamknutej obrazovke pri
  príchode na miesto.
