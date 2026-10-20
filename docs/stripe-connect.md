# Stripe Connect (Express účty)

Peniaze za vstupenky idú organizátorovi priamo z každej platby, zmenšené
o províziu platformy. Bez ručných prevodov raz za obdobie.

## Ako tečú peniaze

Je to **destination charge**: zákazník platí nám (platforma je obchodník),
Stripe z platby odvedie našu províziu a zvyšok prevedie na Express účet
organizátora.

```
zákazník → Checkout Session (mode=payment, EUR, locale sk)
              │
              ├─ application_fee_amount  → platforma (provízia)
              └─ transfer_data[destination] → acct_… organizátora
```

Prečo takto a nie direct charge na účet organizátora: zákazník má na výpise
nás, čo sedí s obchodnými podmienkami (predaj „v mene a na účet
usporiadateľa", čl. 1.2) a reklamáciu aj refund riešime my. Pri direct charge
by bol obchodníkom organizátor a zákazník by nás na výpise nenašiel.

**Prečo Express a nie Standard či Custom:** organizátor prejde formulárom
Stripe za pár minút, overenie identity aj výplaty rieši Stripe a my jeho
doklady ani číslo účtu nikdy nevidíme. Standard by vyžadoval, aby mal vlastný
Stripe účet; Custom by naložil overovanie na nás.

## Čo si držíme v databáze

V `profiles` len `stripe_account_id` a tri príznaky z `account.updated`.
Žiadne doklady, žiadne bankové údaje — tie zostávajú u Stripe.

| Stĺpec | Načo |
|---|---|
| `stripe_account_id` | Express účet (`acct_…`), unikátny index |
| `stripe_charges_enabled` | Stripe povolil prijímať platby — bez toho sa kartou zaplatiť nedá |
| `stripe_payouts_enabled` | Stripe posiela výplaty |
| `stripe_details_submitted` | Organizátor formulár odoslal |
| `stripe_requirements` | Čo Stripe ešte potrebuje; zobrazuje sa organizátorovi |
| `stripe_account_updated_at` | Kedy sme stav naposledy overili |

K objednávke sa ukladá `application_fee_cents` a `transfer_destination` —
aby sa po roku dalo doložiť, koľko si platforma vzala a komu išiel zvyšok,
bez dotazovania Stripe API.

**Práva sú tu podstatné.** `stripe_account_id` si organizátor nesmie nastaviť
sám; kto si prepíše to pole, presmeruje si výplaty za cudzie podujatia.
Migrácia tie stĺpce `authenticated` odoberá (rovnako ako `commission_rate`)
a píše ich výhradne server. Čítanie organizátorovi zostáva — musí vidieť,
či mu Stripe už povolil platby.

## Onboarding organizátora

Obrazovka je `/organizer/payouts` (bočné menu → Výplaty).

1. Organizátor klikne **Nastaviť výplaty**.
2. `zalozUcetAkTreba` vytvorí Express účet, ak ho ešte nemá. Idempotencia
   stojí na `stripe_account_id` v našej databáze **aj** na
   `Idempotency-Key: account:<id>` — bez toho by každé kliknutie vyrobilo
   ďalší účet.
3. `odkazNaOnboarding` vyrobí **account link** a presmeruje naň. Odkaz je
   jednorazový a krátko platný, preto sa nikam neukladá.
4. Stripe vráti organizátora na `/organizer/payouts?hotovo=1`. Stránka si
   stav rovno dopýta (`obnovStavVyplat`) — nečaká na webhook, nech človek
   nekrúti hlavou, prečo tam ešte svieti „nedokončené".
5. Webhook `account.updated` ten stav udržiava aj potom, keď Stripe overenie
   dokončí o pár hodín.

Výplaty nastavuje až **schválený** organizátor. Neschválený nemá čo predávať.

## Platba

Stripe je štvrtá brána v registri `payment-gateways/index.server.ts` a používa
to isté rozhranie ako GoPay, GP webpay a tatrapay+. Checkout teda nebolo treba
meniť vôbec.

`start()` odmietne založiť platbu, keď organizátor nemá účet alebo mu Stripe
ešte nepovolil platby. Je to vedomé: inak by peniaze skončili na našom účte
bez toho, aby bolo kam ich previesť.

Riadky posielame jednotlivo, nech zákazník vidí, za čo platí. Keď súčet
riadkov nesedí s celkovou sumou (zľava, kupón), pošle sa jeden riadok
s celkovou sumou — inak by Stripe inkasoval inú sumu než má objednávka.

## Webhook

`POST /api/public/payments/stripe/webhook`

Bez overenia podpisu je to otvorené API na vydávanie vstupeniek — kto pozná
adresu, pošle si „zaplatené" a dostane lístky. Preto sa podpis overuje nad
**surovým** telom ako prvá vec (`stripe-podpis.server.ts`, HMAC-SHA256,
tolerancia 5 minút, porovnanie v konštantnom čase) a sumám z tela sa neveria.

| Udalosť | Čo sa stane |
|---|---|
| `checkout.session.completed` | `settleOrder(orderId)` — doúčtovanie |
| `checkout.session.async_payment_succeeded` | to isté (oneskorené metódy) |
| `account.updated` | uloží sa stav Express účtu |
| ostatné | potvrdí sa 200, nespracúvame |

Objednávka sa hľadá **len** podľa `metadata.orderId`, ktoré tam dávame pri
zakladaní platby. Keby sa hľadala napríklad podľa sumy, dala by sa cudzej
platbe priradiť nesprávna objednávka.

**Vstupenky nevydáva webhook.** Robí to `settleOrder` v
`order-settlement.server.ts` spoločne pre všetky brány — vrátane podpísaného
QR (`MT2.<id>.<hmac>`), faktúry, e-mailu a uvolnenia kupónu. Druhá kópia tej
logiky by sa rozišla. Celé doúčtovanie je idempotentné, takže zopakovaná
notifikácia nič nerozbije a na 500 môže Stripe pokojne skúsiť znova.

## Refund a zrušené podujatie

Refund beží existujúcou cestou (`refunds.server.ts`, `refundOrder`,
`event-cancellation.functions.ts`) — Stripe len implementuje `refund()`
z rozhrania brány. Telo refundu posiela **oboje**:

```
reverse_transfer: true        → vráti prevod od organizátora
refund_application_fee: true  → vráti aj našu províziu
```

Bez prvého by sa peniaze stiahli z nášho účtu a organizátorovi by zostali.
Bez druhého by si platforma nechala províziu za podujatie, ktoré sa nekonalo.
Pri zrušenom podujatí je to jediné správne: zákazník nedostal nič, takže si
nemáme čo nechať.

## Prístupy

Dva kľúče, vkladajú sa v `/admin/system/payments` (šifrujú sa do
`integration_credentials`), prípadne ako premenné prostredia:

| Premenná | Odkiaľ |
|---|---|
| `STRIPE_SECRET_KEY` | Developers → API keys. Ostrý začína `sk_live_` |
| `STRIPE_WEBHOOK_SECRET` | Developers → Webhooks, po pridaní našej adresy. Začína `whsec_` |

**Testovacia prevádzka sa u Stripe nepozná z adresy**, ale z predpony kľúča —
`api.stripe.com` je tá istá pre test aj ostro. Preto má rozhranie brány
voliteľné `rezim()` a admin ho preferuje pred odhadom z adresy. Bez toho by
pri Stripe svietilo „neznáma" a nikto by si nevšimol, že sa predáva do piesku.

## Čo treba spraviť pred prvou platbou

1. **Prehrať migráciu** `20261020150000_stripe_connect.sql` (nasucho prešla,
   čaká na schválenie). Pridáva hodnotu `stripe` do enumu
   `payment_provider` — **bez nej doúčtovanie spadne na zápise**.
2. Vložiť oba kľúče v admine.
3. Pridať adresu webhooku v Stripe dashboarde a zapnúť udalosti
   `checkout.session.completed`, `checkout.session.async_payment_succeeded`
   a `account.updated`.
4. Nechať organizátora prejsť onboardingom a overiť, že má
   `charges_enabled`.
5. Jeden ostrý nákup s najmenšou sumou, potom refund — rovnako ako pri
   každej inej bráne.

## Čo zadanie chcelo inak

Zadanie predpokladalo prázdny projekt: vytvoriť tabuľky `organizers`,
`events`, `orders`, `tickets` a v webhooku založiť objednávku a vstupenky.

Tu ale všetky štyri veci existujú a sú plné dát (138 podujatí, 92 objednávok,
1 012 vstupeniek), organizátori žijú v `profiles` so stavom schválenia,
subdoménou a províziou, vstupenky majú podpísaný QR a objednávka sa zakladá
**pred** platbou. Vytvoriť to nanovo by znamenalo druhý systém vedľa
bežiaceho, a webhook, ktorý zakladá objednávku, by vyrobil druhú objednávku
k tej istej platbe.

Preto: Stripe je zapojený do existujúcich tabuliek a do existujúceho
doúčtovania, migrácia pridáva len to, čo chýbalo, a RLS na `events`,
`orders` aj `tickets` zostalo nedotknuté.

## Testy

`stripe-telo.test.ts` (29) pokrýva počítanie provízie a skladanie tiel:
zaokrúhľovanie centov, strop provízie, kódovanie do formátu, ktorý Stripe
berie, jeden riadok pri zľave, a že refund posiela oba príznaky.

`stripe-podpis.server.test.ts` (12) pokrýva podpis: zmenené telo o jeden znak
neprejde, podvrhnutá suma neprejde, cudzí kľúč neprejde, starý podpis
neprejde (ochrana proti prehraniu), rotácia kľúča s dvoma podpismi prejde.
