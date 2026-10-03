# Subdomény organizátorov

`bbd.eticketo.eu` otvorí ten istý obchod, zúžený na podujatia jedného
organizátora. V admine to je jedno zakliknutie v *eticketo → Nový organizátor*
(alebo neskôr pri existujúcom organizátorovi).

## Čo je hotové v aplikácii

| | |
|---|---|
| Kde sa drží | `profiles.subdomain` (unikátne bez ohľadu na veľkosť písmen) |
| Pravidlá | `src/lib/subdomena.ts` — tvar, rezervované názvy, návrh z názvu |
| Preklad adresy | `src/lib/subdomena.server.ts` — `Host` → organizátor |
| Obchod | `useEvents({scope:"public"})` zúži katalóg, keď je adresa subdoménou |
| Admin | `/admin/eticketo/organizer-new` — zakliknutie, návrh, overenie adresy |
| Migrácia | `20261002120000_organizator_subdomena.sql` |

Tvar: malé písmená, číslice a spojovník, 3–32 znakov. Rezervované názvy
(`www`, `api`, `admin`, `scanner`, `checkout`, …) sú v zozname na troch
miestach naraz — v aplikácii, v databázovom `check` a pri čítaní `Host`.
Zámerne: subdoména je verejná adresa, na ktorú budú ukazovať plagáty.

Neznáma subdoména sa chová ako hlavná adresa, nie ako prázdny obchod.

## Čo musí raz spraviť správca servera

**Toto aplikácia nerobí a robiť nebude.** Zasahovalo by to do DNS, certifikátov
a nginxu, teda do perimetra. Po týchto troch krokoch je zakliknutie v admine
naozaj všetko, čo treba — žiadny krok na organizátora.

1. **Zástupný DNS záznam.** U správcu domény pridať
   `*.eticketo.eu  A  116.202.234.209` (tá istá adresa ako `eticketo.eu`).
   Overenie: `getent hosts cokolvek.eticketo.eu`.
2. **Wildcard certifikát.** Let's Encrypt ho vydá len cez výzvu DNS-01, takže
   certbot potrebuje prístup k API správcu DNS:
   ```
   certbot certonly --dns-<poskytovatel> \
     -d 'eticketo.eu' -d '*.eticketo.eu' \
     --cert-name eticketo.eu
   ```
   Obnova potom beží sama v `certbot.timer`, ktorý už na stroji je.
3. **nginx.** V `/etc/nginx/sites-enabled/eticketo` rozšíriť `server_name`
   na `eticketo.eu www.eticketo.eu *.eticketo.eu` a v bloku 443 použiť ten
   wildcard certifikát. Zvyšok konfigurácie (proxy na `127.0.0.1:3000`,
   `root` pre statiku) sa nemení — appka rozlíši adresu sama z hlavičky `Host`.

Kým tieto tri veci nie sú hotové, subdoména sa **dá zapísať**, ale adresa sa
neotvorí. Preto je v admine tlačidlo **Overiť adresu**: pozrie DNS aj HTTPS
naživo a napíše, v ktorom z týchto stavov sa práve nachádzame. Lepšie než
sľúbiť divadlu adresu, ktorá nefunguje.

### Prečo nie certifikát na každú subdoménu zvlášť

Dalo by sa to — certbot na každé založenie organizátora. Ale: chcelo by to
práva roota z aplikácie, reload nginxu po každom organizátorovi a narazilo by
to na limity Let's Encryptu (50 certifikátov na domému za týždeň). Wildcard je
jeden úkon raz a potom nula údržby.

## Na čo si dať pozor

- **Odkazy, ktoré opúšťajú server, vedú na hlavnú adresu.** Návrat z platobnej
  brány, notifikácia o zaplatení aj odkaz na vstupenky v e-maile sa skladajú
  z `PUBLIC_SITE_URL` (`src/lib/site-url.server.ts`). Je to zámer: brány majú
  návratovú adresu zaregistrovanú a wildcard by im nesedel. Zákazník teda kúpi
  na `bbd.eticketo.eu` a po platbe sa vráti na `eticketo.eu`. Ak to má byť
  inak, treba to najprv dohodnúť s bránou, nie zmeniť v kóde.
- **SEO.** Tie isté podujatia budú dostupné na dvoch adresách. Keď sa
  subdomény spustia, treba na stránku podujatia doplniť kanonický odkaz na
  hlavnú adresu a `sitemap.xml` ponechať len na hlavnej.
- **Starý systém mal subdomény tiež** (`om_events.id_subdomain`, v dátach ich
  je zhruba 14 a najväčšia drží 285 predstavení). Názvy sa nesynchronizujú,
  takže keď sa má zachovať adresa, ktorú divadlo používalo doteraz, treba ju
  vypýtať od Patrika alebo nájsť v exporte starého systému.
- `om_event_map` ani skener sa subdoménou neriadia — skenovanie stojí na
  `scanner_token` podujatia, nie na adrese.
