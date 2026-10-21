# ComGate (CZK a EUR)

Piata platobná brána. Karta, Google Pay, Apple Pay a prevody z českých aj
slovenských bánk, v korunách aj eurách.

Postavené na **v2.0 REST** (`apidoc.comgate.cz/en/api/rest`): telo je JSON
a prihlásenie je v hlavičke. Staršie form API v1.0 by znamenalo posielať
`merchant`, `secret` aj `prepareOnly` v každom tele.

## Pozor: v korunách sa zatiaľ predať nedá

Brána CZK zvládne a je to otestované. **Katalóg ale ceny v korunách nemá.**
`orders.currency` má default `EUR`, všetkých 92 objednávok je v EUR a stĺpce
s cenami (`events.base_price`, cenníky) menu nenesú — sú implicitne v eurách.

Takže dnes ComGate inkasuje v EUR, správne. Aby kupujúci zaplatil v CZK,
treba sa najprv rozhodnúť **ako**, a to nie je programátorské rozhodnutie:

- **ceny v CZK na podujatí** (druhá cena vedľa eurovej) — presné, ale
  dotýka sa cenníkov, DPH, faktúr a zúčtovania organizátorom;
- **prepočet kurzom** — rýchle, ale niekto musí povedať, odkiaľ kurz berieme,
  ako často a kto nesie kurzový rozdiel.

Kurz som si zámerne nevymyslel. Inak by sa zákazníkovi zaúčtovala suma, ktorú
nikto neschválil.

## Prístupy

Dva povinné, jeden voliteľný. Vkladajú sa v `/admin/system/payments`
(šifrujú sa do `integration_credentials`) alebo ako premenné prostredia.

| Premenná | Čo to je |
|---|---|
| `COMGATE_MERCHANT` | šesťmiestne číslo napojenia obchodu z portálu ComGate |
| `COMGATE_SECRET` | heslo pre komunikáciu na pozadí |
| `COMGATE_TEST` | `1` = simulované platby; prázdne = ostrá prevádzka |

**Testovacia prevádzka sa nepozná z adresy.** `payments.comgate.cz` je tá istá
pre test aj ostro a rozhoduje len príznak `test` v tele. Preto brána
implementuje `rezim()` a admin ho preferuje pred odhadom z adresy — inak by
tam svietilo „neznáma" a nikto by si nevšimol, že sa predáva do piesku.

**Prístup k API je chránený zoznamom povolených IP**, ktorý sa nastavuje
v portáli ComGate (Integrace → Nastavení obchodu → Napojení obchodu). Bez
zapísanej IP servera vráti brána chybu bez ohľadu na správne heslo — preto to
`test()` brány rovno pripomína v chybovej hláške. Podporované je len IPv4.

## Ako platba beží

```
POST /v2.0/payment.json      → { code, message, transId, redirect }
   Authorization: Basic base64(merchant:secret)
   { price, curr, label, refId, method:"ALL", country, lang, … }
```

`price` je **celé číslo v najmenšej jednotke** — `1000` s `curr: "CZK"` je
10,00 Kč. Zákazník sa pošle na `redirect`, `transId` si uložíme do
`orders.payment_ref`.

Ďalšie detaily, ktoré protokol vyžaduje a ktoré sú v kóde:

- `label` smie mať **1–16 znakov**, takže názov podujatia sa skracuje
  (`popisPreVypis`). Zákazník ho vidí na bankovom výpise.
- `country` sa páruje s menou — `CZ` ku CZK, `SK` k EUR. Podľa dokumentácie
  to rozhoduje, aké platobné metódy sa ponúknu.
- Vyžaduje sa **e-mail alebo telefón**; telefón len v medzinárodnom tvare.
- Všetky tri návratové adresy (`url_paid`, `url_cancelled`, `url_pending`)
  mieria na našu stránku objednávky — tá si stav aj tak dopýta sama, takže
  nepotrebuje vedieť z adresy, ako to skončilo.
- Platba vyprší po 30 minútach (`expirationTime`).

### Limity na sumu

Brána má pre každú menu vlastné minimum a maximum a kontrolujeme ich ešte
pred odoslaním — inak zákazník uvidí len „platbu sa nedá založiť".

| Mena | Minimum | Maximum |
|---|---|---|
| EUR | 0,10 | 40 000 |
| CZK | 1 | 1 000 000 |

## Notifikácia

`POST /api/public/payments/comgate/notify`

Adresa sa nastavuje **v portáli ComGate**, nie pri zakladaní platby
(Integrace → Nastavení obchodu → Napojení obchodu, pole pre výsledok na
pozadí).

**ComGate notifikáciu nepodpisuje.** Posiela v tele pole `secret` — to isté
heslo, ktorým sa prihlasujeme k API. Overenie preto stojí na dvoch veciach
a ani jedna sama nestačí:

1. `secret` sa porovná s našim **v konštantnom čase**; keď nesedí, 403.
   Bez toho stačí poznať adresu a poslať si „PAID".
2. Telu sa **neveria sumy ani stav** — doúčtovanie si stav vypýta priamo
   z `/v2.0/payment/transId/…`. Dokumentácia ComGate to výslovne žiada:
   *„the payment status should never be evaluated solely based on the received
   notification"*. Bez toho stačí poslať podvrhnutú sumu.

Obmedzenie na IP brány patrí do nginxu, nie do aplikácie — perimeter je
Patrikov a navyše dnes zlieva adresy, takže by tu nefungovalo.

Objednávka sa hľadá **len** podľa `payment_ref`. Podľa `refId` (variabilný
symbol) zámerne nie: ten podľa dokumentácie **nie je unikátny**, takže by sa
notifikácia dala priradiť nesprávnej objednávke.

Rozhodovanie je vytiahnuté do `rozhodniONotifikacii` a otestované po vetvách —
je to bezpečnostné rozhodnutie, nemá žiť nepokryté v route.

**Odpovedať treba 2xx.** Na čokoľvek iné brána notifikáciu posiela znova,
podľa dokumentácie až tisíckrát, a potom pošle e-mail na kontakt v portáli.
Vstupenky vydáva `settleOrder` spoločne pre všetky brány a je idempotentné —
čo ComGate priamo vyžaduje („goods are issued to the Payer only once, even if
the result of the same payment is passed to the Client's server multiple
times").

## Stavy

| ComGate | U nás | Poznámka |
|---|---|---|
| `PAID` | `paid` | jediný stav, ktorý znamená zaplatené |
| `CANCELLED` | `cancelled` | konečný |
| `PENDING` | `pending` | výsledok ešte nie je známy |
| `AUTHORIZED` | `pending` | len predautorizácia karty — peniaze **neprišli** |

`AUTHORIZED` mapujeme na `pending` zámerne: bez `capturePreauth` sa nič
nestrhne. Predautorizáciu nepoužívame, ale keby sa objavila, rozhodne to nie
je „zaplatené". Neznámy stav sa tiež nikdy nevyhodnotí ako zaplatený.

## Refund a zrušenie

| Čo | Ako |
|---|---|
| refund | `POST /v2.0/refund.json` — čiastočný aj celý, suma v najmenšej jednotke |
| zrušenie | `DELETE /v2.0/payment/transId/{transId}.json` |

Refundovať sa dá len **zaplatená** platba; nezaplatená sa ruší. Testovaciu
platbu vracia len testovací refund. Refund beží existujúcou cestou
(`refunds.server.ts`, `refundOrder`, rušenie podujatia) — ComGate len
implementuje `refund()` z rozhrania brány.

Dokumentácia **nehovorí** o časovom limite na refund, o maximálnom počte
čiastočných refundov ani o tom, či sa dá refundovať `AUTHORIZED` platba.
Chyba 1402 („refundovaná suma je vyššia než povolená") naznačuje, že si brána
drží kumulatívny strop.

## Čo treba pred prvou platbou

1. **Prehrať migráciu** `20261021120000_comgate.sql` (nasucho prešla, čaká na
   schválenie). Pridáva hodnotu `comgate` do enumu `payment_provider` —
   **bez nej doúčtovanie spadne pri zápise** a stalo by sa presne to, čoho sa
   chceme vyhnúť: peniaze prišli, vstupenka nevznikla.
2. Vložiť `COMGATE_MERCHANT` a `COMGATE_SECRET` v admine.
3. Zapísať IP servera do zoznamu povolených v portáli ComGate.
4. Nastaviť v portáli návratové adresy a hlavne **adresu pre výsledok na
   pozadí** na `https://eticketo.eu/api/public/payments/comgate/notify`.
5. Overiť v portáli, že obchod má povolené **EUR** (a prípadne CZK).
   Dokumentácia nehovorí, ako sa mena zapína — to je na ComGate.
6. `COMGATE_TEST=1`, jedna skúšobná platba, potom testovací refund. Až potom
   prepnúť na ostrú.

## Čo dokumentácia nehovorí

Zapísané, aby sa to nehľadalo znova:

- **Aké parametre brána pridá do návratovej adresy** pri presmerovaní
  zákazníka. Preto naša stránka objednávky nič z adresy nečíta a stav si
  dopytuje — čo je aj tak správnejšie.
- Presné IP rozsahy brány (sú na `apidoc.comgate.cz/en/zabezpeceni`).
- Testovacie čísla kariet a či testovacia platba naozaj prechádza bankou.
- Ako sa obchodu zapína ďalšia mena.
- Či sa `secret` z notifikácie **musí** porovnávať — dokumentácia to
  odporúča slovami, ale ich vzorové handlery to nerobia. My to robíme.

## Testy

`comgate-telo.test.ts` (25) — meny, prevod na haliere a centy, limity pre
obe meny zvlášť (0,50 je v EUR dosť, v CZK málo), skrátenie `label` na 16
znakov, párovanie `country` s menou, a že neznámy stav sa nikdy nevyhodnotí
ako zaplatený.

`comgate-notifikacia.server.test.ts` (19) — porovnanie hesla v konštantnom
čase, čítanie JSON aj form tela (vrátane presne toho z dokumentácie ComGate),
a všetky vetvy rozhodovania: podvrhnuté `PAID` s cudzím heslom neprejde,
notifikácia bez hesla neprejde, a heslo sa overuje **skôr** než čitateľnosť
tela — o formáte sa cudzí volajúci nemá čo dozvedieť.
