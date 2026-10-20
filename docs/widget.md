# Widget na web organizátora

Organizátor si vloží na vlastnú stránku dva riadky a zobrazia sa mu na nej jeho
podujatia s tlačidlom na kúpu. Generátor úryvku so živou ukážkou je
v `/organizer/widget`.

```html
<div id="eticketo"></div>
<script
  src="https://eticketo.eu/widget.js"
  data-organizator="mskspezinok"
  defer></script>
```

## Prečo takto

**Vložený script, nie WordPress plugin.** Funguje na akomkoľvek webe —
WordPress, Wix, vlastné HTML — a aktualizuje sa sám, bez toho, aby organizátor
čokoľvek inštaloval alebo my vydávali verzie a čakali na schválenie v katalógu
WordPress.org. Keby bol raz plugin potrebný, bude to tenký obal, ktorý vloží
ten istý script.

**Nákup sa otvára na eticketo.eu v novej karte.** Platba vo vnorenom ráme na
cudzej doméne je zlý zvyk: zákazník nevidí, komu zadáva kartu, a 3DS sa v ráme
často ani nedokončí. Odkaz má preto `target="_blank"` a povinné
`rel="noopener"`.

**Shadow DOM.** Vzhľad widgetu nerozhodí CSS cudzieho webu a naše štýly
nerozhodia jeho. Všetok text sa vkladá cez `textContent`, nikdy ako HTML.

## Atribúty

| Atribút | Hodnoty | Predvolené | Platí pre |
|---|---|---|---|
| `data-organizator` | subdoména organizátora | — | režim `zoznam` |
| `data-podujatie` | uuid podujatia | — | režimy `podujatie`, `tlacidlo` |
| `data-rezim` | `zoznam`, `podujatie`, `tlacidlo` | `zoznam` | vždy |
| `data-pocet` | 1 – 20 | 5 | režim `zoznam` |
| `data-vzhlad` | `auto`, `svetly`, `tmavy` | `auto` | vždy |
| `data-farba` | hex, napr. `#fe6a00` | `#fe6a00` | vždy |
| `data-ciel` | id prvku, kam sa vykreslí | `eticketo` | vždy |

Čomu script nerozumie, nahradí predvoleným — preklep v atribúte nesmie zhodiť
stránku organizátora. Bez `data-ciel` aj bez `<div id="eticketo">` sa widget
vykreslí hneď za script.

## API

`GET /api/widget/events?organizator=<subdomena>&pocet=N`
`GET /api/widget/events?podujatie=<uuid>`

Vracia `{ organizator: { nazov, subdomena } | null, podujatia: [...] }`.
Odpoveď má `Access-Control-Allow-Origin: *` (volá sa z cudzích domén)
a `Cache-Control: max-age=60`. Samotný `widget.js` sa kešuje hodinu.

Strop je **spoločný**, nie na IP: perimeter dnes zlieva adresy, takže limit na
IP by bol strop na celý web (pozri `src/lib/ip.ts`). Keď sa NAT opraví, strop
na IP (600/h) sa aktivuje sám.

## Čo API vydáva a čo nie

Vracia výhradne to, čo je na eticketo.eu aj tak verejné: **zverejnené,
nezrušené a budúce** podujatia **schváleného** organizátora, a z nich len
názov, dátum, čas, miesto, mesto, obrázok, kategóriu a cenu od. Presne to
isté dnes prečíta kdokoľvek anonymným kľúčom cez Supabase REST (politika
`events_public_published_select`), takže tento koncový bod neodkrýva nič nové.

Žiadne objednávky, vstupenky, kontakty ani počty predaného. Overené naživo:
nezverejnené podujatie vráti prázdny zoznam, neznámy organizátor prázdny
zoznam, neplatná subdoména alebo id skončí na 400.

Aj v režime jedného podujatia sa kontroluje, že organizátor je schválený —
inak by sa widgetom dalo obísť schvaľovanie.

## Kde to žije

| Súbor | Čo robí |
|---|---|
| `src/lib/widget.ts` | čisté časti: overovanie parametrov, adresy, úryvok kódu |
| `src/lib/widget-script.ts` | zdroj skriptu pre cudzí web (vanilla JS ako text) |
| `src/routes/widget[.]js.ts` | servíruje `/widget.js` s doplnenou adresou webu |
| `src/routes/api.widget.events.ts` | dáta pre widget |
| `src/routes/organizer.widget.tsx` | generátor úryvku so živou ukážkou |

## Testy

`widget.test.ts` pokrýva overovanie parametrov a skladanie úryvku,
`widget-script.test.ts` invarianty skriptu (žiadne `innerHTML`, `noopener`,
Shadow DOM, bez cookies) a `widget-vykreslenie.test.ts` **skutočné
vykreslenie**: skript sa spustí nad atrapou DOM a kontroluje sa, že vznikne
karta na každé podujatie, že v odkaze je `utm_source=widget`, že dvojité
vloženie nekreslí dvakrát a že pád API nezhodí stránku organizátora.

Atrapa namiesto `jsdom`, lebo `jsdom` v projekte nie je a pridávať závislosť
pre jeden test sa neoplatí — widget používa z DOM len `createElement`,
`appendChild`, `textContent`, `dataset`, `attachShadow` a `matchMedia`.

## Živá ukážka v admine

Ukážka je `iframe srcdoc` so `sandbox="allow-scripts allow-popups"`, teda
**bez** `allow-same-origin`. Má pôvod `null`, takže sa chová presne ako cudzí
web organizátora a zároveň sa nedostane k našim cookies ani k session.

## Čo by sa dalo pridať

- Filtrovanie zoznamu podľa kategórie alebo mesta.
- Obsadenosť („zostáva 43 miest") — dnes sa do widgetu zámerne neposiela,
  lebo by to bol nový údaj navonok a treba sa rozhodnúť, či ho chceme
  zverejňovať.
- WordPress plugin ako obal nad týmto scriptom.
