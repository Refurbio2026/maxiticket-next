# Register firiem v checkoute

Keď si zákazník zaškrtne **Kupujem na firmu**, objaví sa nad firemnými poliami
vyhľadávanie. Zadá IČO, IČ DPH alebo názov a údaje sa doplnia z registra.

## Odkiaľ sa berú údaje

| Zdroj | Čo dá | Cena |
|---|---|---|
| **RPO** (Štatistický úrad SR) | názov, IČO, sídlo, zápis v obchodnom registri | bezplatné, bez kľúča |
| **VIES** (EÚ) | overenie IČ DPH + názov a adresa k nemu | bezplatné |
| **FinStat** | navyše **DIČ a IČ DPH** | platené, zatiaľ nenapojené |

**RPO nedáva DIČ ani IČ DPH.** Je to oficiálny register právnických osôb, nie
daňový. Preto to formulár hovorí zákazníkovi rovno: *„DIČ a IČ DPH register
nedáva — tie doplň sám."*

### Prečo FinStat zatiaľ nie je napojený

Je **platený** (balíky PREMIUM a vyššie) a jeho technická dokumentácia —
vrátane presného spôsobu podpisu požiadavky — je prístupná **len zákazníkom po
prihlásení**. Podpis sa nedá uhádnuť a hádať sa nebude: zle podpísané volanie
by tichodko vracalo chybu a vyzeralo by to ako porucha registra.

Keď bude kľúč aj dokumentácia, doplní sa ako ďalší zdroj k RPO a začne dávať
DIČ aj IČ DPH. `finstatStav()` to hlási v jednej vete.

## Čo sa stane, keď register nejde

Nič sa nezablokuje. Toto nie je teoretická obava — **register bol pri písaní
tohto kódu nedostupný** (DNS vedie na Oracle WAF, spojenie padalo na timeout),
hoci deň predtým fungoval.

Preto:

- každé volanie má **časový limit 4 sekundy**; zákazník stojí v checkoute,
- zlyhanie sa vracia ako „nenašlo sa" s vysvetlením, **nie ako chyba**,
- polia nižšie zostávajú normálne vyplniteľné rukou,
- vyhľadávanie je **na kliknutie**, nie automatické pri písaní — nedostupný
  register tak nespomaľuje písanie.

**Kontrolná číslica IČO sa overuje offline.** To je to podstatné: preklep sa
odhalí okamžite aj vtedy, keď register neodpovedá. Overené naživo — `53251581`
dostane *„Toto IČO neprešlo kontrolou — skontroluj, či si neprehodil
číslice."* bez jediného volania von.

Pri IČ DPH sa rozlišuje **„neplatné"** od **„nepodarilo sa overiť"**.
Zákazníkovi sa nesmie tvrdiť, že má zlé IČ DPH, len preto, že služba EÚ
práve nejde.

## Kde to žije

| Súbor | Čo robí |
|---|---|
| `src/lib/firmy/firmy.ts` | čisté: normalizácia, **kontrolná číslica IČO**, druh dotazu, zlučovanie zdrojov |
| `src/lib/firmy/rpo-parse.ts` | čítanie odpovede RPO |
| `src/lib/firmy/firmy.server.ts` | volania do RPO a VIES, stav FinStatu |
| `src/lib/firmy.functions.ts` | serverová funkcia pre checkout, s brzdou |
| `src/components/checkout/VyhladajFirmu.tsx` | pole a ponuka v checkoute |

Volá sa to **bez prihlásenia** z verejného checkoutu, takže to má brzdu
(60 hľadaní za hodinu na IP; kým perimeter zlieva adresy, spoločných 600).
Je to len čítanie z verejných registrov a nič o našich zákazníkoch to
neprezrádza.

## Pozor na históriu v RPO

Register drží **históriu**: názvy, adresy aj zápisy sú polia s platnosťou
od–do. MaxiTicket má v registri tri adresy, z toho dve neplatné (Trnava,
Kučišdorfská dolina). Keby sa bral prvý prvok, firma po presťahovaní by
dostala starú adresu — preto `aktualny()` vyberá záznam bez `validTo`,
a keď ich je viac, ten s najnovším `validFrom`.

Je to otestované na **skutočnej odpovedi** registra uloženej v
`rpo-parse.test.ts`, vrátane kontroly, že sa Trnava vo výsledku neobjaví.

## Testy

36 testov. Zaujímavé miesta:

- **kontrolná číslica IČO** na dvoch skutočných firmách (MaxiTicket
  `53251580`, MsKS Pezinok `00305022`), na preklepe v poslednej číslici,
  na prehodených číslicach, a na dvoch vetvách algoritmu so zostatkom 0 a 1,
  ktoré sa ľahko pokazia,
- **rozpoznanie dotazu** — testy odhalili, že „MsKS Pezinok" po odstránení
  medzier prechádzalo ako IČ DPH štátu „MS"; odvtedy musí telo IČ DPH začínať
  číslicou,
- **zlučovanie zdrojov** — nikdy neprepíše vyplnenú hodnotu prázdnou, inak by
  druhý zdroj vymazal, čo prvý našiel,
- **výber platného záznamu** z histórie RPO.

## Čo nie je overené naživo

**Úspešné vyhľadanie.** Register je v čase písania nedostupný, takže sa dalo
overiť len to, že sa to zachová dôstojne. Rozpoznanie odpovede je ale
otestované na skutočných dátach, takže keď register ožije, malo by to sedieť —
stojí za to to vtedy raz skúsiť.
