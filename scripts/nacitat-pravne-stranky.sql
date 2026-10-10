-- Načítanie právnych stránok eticketa.
--
-- Štyri stránky v `site_pages` existujú, ale majú nula znakov a nie sú
-- zverejnené, takže pätička neukazuje žiadny právny odkaz. Pri predaji
-- spotrebiteľovi na diaľku je to zákonná povinnosť, nie kozmetika.
--
-- Texty sú prevzaté z Všeobecných obchodných podmienok MaxiTicketu
-- (https://vstupenky.maxiticket.sk/vseobecne.obchodne.podmienky, účinné od
-- 1. 7. 2022) — prevádzkovateľom oboch systémov je tá istá spoločnosť,
-- MaxiTicket s.r.o. Pôvodný dokument mal deväť článkov vrátane reklamačného
-- poriadku (čl. 6) a ochrany osobných údajov (čl. 8); tu sú rozdelené na tri
-- samostatné stránky s krížovými odkazmi.
--
-- Telo NIE JE HTML. `p.$slug.tsx` renderuje zámerne jednoduchý formát:
-- prázdny riadok = odsek, riadok s `## ` = medzinadpis, `- ` = odrážka.
-- Vložené HTML by bola diera, preto sa pôvodné HTML prevádzalo na text.
--
-- Stránky sa nahrávajú ako **nezverejnené**. Prečítaj si ich v administrácii
-- (Obsah stránok) a zverejni sám — sú to právne texty a majú ísť na web až
-- keď si ich odsúhlasil.
--
-- Stránka `about` (O nás) tu nie je: na starom webe k nej nič nebolo
-- a marketingový text o vlastnej firme nemám odkiaľ vziať.
--
-- SPÚŠŤANIE: skript je NASUCHO — končí `rollback`. Keď ti výpis sedí, zmeň
-- poslednú riadku na `commit` a spusti znova:
--
--   /opt/maxiticket/restore/psql.sh -f scripts/nacitat-pravne-stranky.sql

begin;

\echo ''
\echo '=== PRED: stav právnych stránok ==='
select slug, published, length(body) as znakov from public.site_pages order by sort_order;

update public.site_pages
   set title = 'Všeobecné obchodné podmienky',
       meta_description = 'Podmienky predaja vstupeniek na eticketo.eu — platba, dodanie, práva a povinnosti.',
       body = $telo$Účinné od 1. 7. 2022. Tieto podmienky prevzalo eticketo.eu z predchádzajúceho systému MaxiTicket; prevádzkovateľom oboch je tá istá spoločnosť.

Spoločnosť MaxiTicket s.r.o., so sídlom Drevárska 23, 902 01 Pezinok, IČO 53251580, zapísaná v obchodnom registri Okresného súdu Bratislava I, oddiel Sro, vložka č. 14844, prevádzkuje systém eticketo na adrese eticketo.eu. Tam, kde sa ďalej hovorí o MaxiTicket, ide o túto spoločnosť.

Všeobecné obchodné podmienky upravujú právne vzťahy medzi majiteľom zakúpenej vstupenky na strane jednej a spoločnosťou MaxiTicket s.r.o., so sídlom: Drevárska 23, 902 01 Pezinok, IČO: 53251580, zapísaná v obchodnom registri Okresného súdu Bratislava I, oddiel Sro, vložka č. 148442/B (ďalej len „MaxiTicket“) na strane druhej (ďalej len „VOP“).

## 1. Definícia pojmov

1.1 MaxiTicket je prevádzkovateľom graficky orientovaného sieťového riešenia eticketo na predaj vstupeniek a správu štadiónov, kultúrnych centier, alebo podujatí na Slovensku a v krajinách Európy (ďalej len „MaxiTicket“).

1.2 MaxiTicket je oprávnené na základe dohody so zmluvnými partnermi (ďalej len „usporiadateľ“) využívajúcimi systém eticketo na správu svojich podujatí, na tieto podujatia zaradené v systéme MaxiTicket zabezpečovať predaj vstupeniek prostredníctvom systému eticketo konečným záujemcom (návštevníkom), a to v mene usporiadateľa a na jeho účet.

1.3 Usporiadateľ je fyzická alebo právnická osoba, ktorá na predaj a elektronickú distribúciu vstupeniek na svoje podujatia využíva systém MaxiTicket.

1.4 Podujatie je verejné predstavenie, podujatie, koncert alebo spoločenská akcia kultúrneho alebo športového charakteru, na ktoré sa predávajú vstupenky prostredníctvom systému eticketo. Podujatia organizuje a usporadúva usporiadateľ (ďalej len „podujatie“).

1.5 Vstupenka je cenina a zároveň potvrdenie umožňujúce jej majiteľovi vstupenky spravidla jednorazový vstup na podujatie, na ktoré bola zakúpená. Vstupenka je platná len na podujatie, na ktoré bola zakúpená, nie je možné ju použiť na vstup na iné podujatie ani ju vymeniť za vstupenku na iné podujatie. Aktuálne ceny vstupeniek sú uverejnené na internetovej stránke usporiadateľa.

Vstupenka obsahuje: názov, dátum, čas začiatku a miesto konania podujatia, presný popis miesta sedenia ak je toto určené, cenu vstupenky, čiarový kód, alebo QR kód s unikátnym číslom vstupenky, identifikáciu usporiadateľa podujatia a prípadný ochranný prvok ak je tento súčasťou vstupenky.

1.6 Majiteľ vstupenky je osoba, ktorá si zakúpila Vstupenku prostredníctvom systému eticketo, cez internetovú stránku  eticketo.eu, internetovú stránku Usporiadateľa alebo cez partnerské webové stránky, alebo v predajni usporiadateľa.

1.7 Typy vstupenky

1.7.1 papierová vstupenka s ochrannými prvkami (ďalej ako „vstupenka“) je štandardná vstupenka vystavená systémom eticketo a doručená majiteľovi vstupenky kuriérom alebo poštou. Náklady na poštovné a balné znáša majiteľ vstupenky. Majiteľovi vstupenky sú tieto náklady zarátané do celkovej ceny objednávky po označení príslušnej voľby v kolónke spôsob doručenia.

1.7.2 ticket@home je elektronická forma vstupenky s 2D čiarovým kódom bez ochranných prvkov (ďalej ako „ticket@home“) doručená majiteľovi vstupenky na e-mailovú adresu alebo prístupná majiteľovi vstupenky na stiahnutie z internetovej stránky po zadaní emailovej adresy a užívateľského hesla, ktoré sú majiteľovi vstupenky poskytnuté po zaplatení ceny vstupenky. ticket@home je vytlačená majiteľom vstupenky v jeho vlastnej réžii.

1.7.3. ticket2mobile s 2D čiarovým kódom uložená v mobilnom telefóne (ďalej ako „ticket2mobile“) je elektronická vstupenka uložená v mobilnom telefóne alebo tablete majiteľa vstupenky.

Dostupnosť jednotlivých druhov vstupeniek závisí od konkrétneho podujatia a možností usporiadateľa.

## 2. Úvodné ustanovenia

2.1 MaxiTicket na základe Zmluvy o spolupráci pri predaji vstupeniek uzatvorenej s usporiadateľom zabezpečuje ako sprostredkovateľ predaj vstupeniek na podujatia v prospech usporiadateľa, a zároveň v mene usporiadateľa prijíma od záujemcov finančné prostriedky zodpovedajúce kúpnej cene vstupeniek. Uhradením ceny vstupenky prostredníctvom internetovej stránky  eticketo.eu­ vstupuje majiteľ vstupenky do právneho vzťahu priamo s konkrétnym usporiadateľom vybraného podujatia.

2.2 MaxiTicket nezodpovedá za konanie, zmenu či zrušenie podujatia. Právny vzťah medzi usporiadateľom podujatia a majiteľom vstupenky upravujú platné obchodné podmienky daného podujatia, prípadne pokyny usporiadateľa.

2.3 Zodpovednosť za zverejnenie informácie o zmene alebo rušení podujatia má usporiadateľ, ktorý túto skutočnosť uverejnení na jeho internetovej stránke.

## 3. Platba za vstupenky

3.1 Kúpna cena Vstupenky je konečná (vrátane DPH ak je Usporiadateľ platcom DPH) a zahŕňa všetky prípadné súvisiace poplatky. V prípade voľby spôsobu doručenia Vstupenky prostredníctvom pošty či kuriéra, je Zákazník povinný uhradiť tiež poštovné a balné podľa stanovenej sadzby. O výške poštovného a balného je Zákazník informovaný pred potvrdením objednávky a tato čiastka je pripočítaná ku kúpnej cene Vstupenky.

3.2 Ak nie je uvedené inak, je k cene vstupeniek pripočítaný poplatok za spracovanie vstupeniek.

3.3 V prípade internetového nákupu je možné konečnú, resp. výslednú cenu vybraných vstupeniek uhradiť platobnou kartou prostredníctvom služby Cardpay (platba cez virtuálny POS terminál Tatrabanky). Platbu je možné realizovať platobnou kartou VISA alebo EUROCARD/MASTERCARD, vydanou ktoroukoľvek bankovou inštitúciou.

3.4 V prípade nákupu v predajni je možné platiť hotovosťou alebo platobnou kartou spoločností VISA a EUROCARD/MASTERCARD.

3.5 Firemná klientela môže platiť bankovým prevodom na základe faktúry.

3.6 Systém MaxiTicket zabezpečuje predaj vstupeniek na podujatia v mene a na účet usporiadateľa podujatia, kúpou vstupenky ste vstúpili do právneho vzťahu - zmluvy na uskutočnenie podujatia - priamo s konkrétnym usporiadateľom vybraného podujatia. V zmysle zákona č. 102/2014 Z.z. o ochrane spotrebiteľa pri predaji tovaru na diaľku alebo mimo prevádzkových priestorov v platnom znení: "Spotrebiteľ nemôže odstúpiť od zmluvy, predmetom ktorej je poskytnutie ubytovacích služieb na iný ako ubytovací účel, preprava tovaru, nájom automobilov, poskytnutie stravovacích služieb alebo poskytnutie služieb súvisiacich s činnosťami v rámci voľného času a podľa ktorej sa predávajúci zaväzuje poskytnúť tieto služby v dohodnutom čase alebo v dohodnutej lehote."

Spoločnosť MaxiTicket nie je oprávnená akceptovať vrátenie už zaplatenej sumy za vstupenku a to ani v prípade žiadosti o vrátenie zaplatenej sumy za nevyužitú vstupenku.

3.7 V prípade zrušenia Podujatia bude Majiteľ vstupenky prostredníctvom internetovej stránky eticketo.eu informovaný o postupe vrátenia vstupného ako aj miest a kontaktov, prostredníctvom ktorých bude vrátenie vstupného prebiehať. V prípade zrušenia Podujatia nemá Majiteľ vstupenky nárok na vrátenie poštovného či iných poplatkov za doručenie Vstupenky a poplatkov za platbu kúpnej ceny Vstupenky. V prípade, že je na internetovej stránke eticketo.eu v informáciách o Podujatí uvedená výška spracovateľského poplatku (v takom prípade je uvedená aj na Vstupenke na Podujatie), nemá Majiteľ vstupenky v prípade zrušenia Podujatia nárok na vrátenie tejto sumy spracovateľského poplatku.

## 4. Dodanie vstupeniek

4.1 V nákupnom košíku je možné si vybrať z nasledovných spôsobov dodania vstupenky:

4.1.2 internetové doručenie na email majiteľa vstupenky ako ticket@home alebo ticket2mobile. Vstupenky sa považujú za doručené momentom odoslania na emailovú adresu zadanú majiteľom vstupenky. Aktuálna výška poplatku, ak je tento usporiadateľom vyžadovaný, je vždy uvedená ako spracovateľský poplatok. Vstupenky budú majiteľovi vstupenky zaslané v lehote do 24 hodín od realizácie platby na emailovú adresu uvedenú pri nákupe vstupeniek.

4.2 MaxiTicket a usporiadateľ nenesie zodpovednosť:

4.2.2 za oneskorené dodanie objednaných vstupeniek zavinené majiteľom vstupenky, ktorý nerešpektuje dodacie podmienky pošty,

4.2.3 za nedodanie objednaných vstupeniek zavinené neúplným, neaktuálnym alebo akokoľvek nesprávnym zadaním poštovej adresy majiteľom vstupenky

## 5. Práva a povinnosti majiteľa vstupenky

5.1. Majiteľ vstupenky je oprávnený použiť vstupenku na jednorazový vstup na podujatie, na ktoré bola zakúpená (s výnimkou tzv. permanentky, t.j. vstupenky na podujatie trvajúce jeden a viac dní – napr. hudobné festivaly a pod.). Po opustení priestoru, v ktorom sa podujatie uskutočňuje, stráca vstupenka (s výnimkou permanentky) platnosť, pokiaľ nie je usporiadateľom výslovne stanovené v prípade konkrétneho podujatia inak.

5.2 Majiteľ vstupenky kúpou vstupenky vstupuje do zmluvného vzťahu s usporiadateľom daného podujatia. Predložením vstupenky pri vstupe na podujatie vyjadruje majiteľ vstupenky súhlas s pokynmi usporiadateľa v mieste konania podujatia a podmienkami, ktoré sa k nim viažu.

5.3 Majiteľ vstupenky je povinný skontrolovať si vstupenku, ticket@home alebo ticket2mobile a údaje na nej okamžite po doručení alebo prevzatí. Prípadné chyby môže majiteľ vstupenky bezodkladne namietať postupom podľa bodu 6 týchto VOP.

## 6. Reklamačný poriadok

Reklamačný poriadok je samostatný dokument: eticketo.eu/p/reklamacny-poriadok

## 7. Zodpovednosť

7.1 MaxiTicket a usporiadateľ nenesie nijakú zodpovednosť za stratu, odcudzenie, poškodenie alebo zničenie vstupenky a nie sú ani povinní poskytnúť majiteľom vstupenky náhradnú vstupenku.

## 8. Ochrana osobných údajov

Spracúvanie osobných údajov opisuje samostatný dokument: eticketo.eu/p/ochrana-osobnych-udajov

## 9. Záverečné ustanovenia

9.1 MaxiTicket je oprávnená jednostranne meniť alebo doplniť ustanovenia VOP z dôvodov doplnenia chýbajúcich podmienok, alebo zmeny legislatívy Slovenskej republiky. Zmena VOP je účinná dňom zverejnenia nového úplného znenia VOP na internetovej adrese  eticketo.eu.

9.2 Návštevník a/alebo používateľ potvrdením záujmu o kúpu vstupenky na vybrané podujatie v systéme MaxiTicket súhlasí so znením týchto VOP, s ktorými bol pri uzatvorení kúpy vstupeniek plne oboznámený a akceptoval ich.

9.3 Všetky vzťahy neupravené týmito VOP sa riadia všeobecne záväznými právnymi predpismi platnými na území Slovenskej republiky.

Patrik Henček, konateľ

MaxiTicket s.r.o., Drevárska 23, 902 01 Pezinok, IČO 53251580 — eticketo.eu
$telo$,
       published = false,
       updated_at = now()
 where slug = 'obchodne-podmienky';

update public.site_pages
   set title = 'Reklamačný poriadok',
       meta_description = 'Ako reklamovať vstupenku kúpenú na eticketo.eu a kam sa obrátiť.',
       body = $telo$Účinné od 1. 7. 2022. Tento reklamačný poriadok bol vyčlenený z článku 6 Všeobecných obchodných podmienok: eticketo.eu/p/obchodne-podmienky

6.1 V prípade, ak zakúpená vstupenka obsahuje vady (t.j. sú na nej uvedené chybné údaje alebo niektoré údaje chýbajú, je vystavená na iné ako majiteľom vstupenky objednané podujatie a pod.), je majiteľ vstupenky povinný bez zbytočného odkladu po jej obdržaní tieto vady u spoločnosti MaxiTicket alebo u usporiadateľa reklamovať. Reklamáciu môže vykonať zaslaním e-mailovej správy na adresu podpora@eticketo.eu, písomnej reklamácie formou poštovej zásielky na adresu usporiadateľa alebo osobne na predajnom mieste usporiadateľa, na ktorom bola vstupenka zakúpená.

## Kam reklamáciu poslať

Reklamáciu vstupenky kúpenej na eticketo.eu pošli na podpora@eticketo.eu. Reklamáciu týkajúcu sa samotného podujatia — jeho konania, zmeny alebo zrušenia — rieši usporiadateľ, s ktorým kúpou vstupenky vzniká zmluvný vzťah; jeho kontakt nájdeš na stránke podujatia.

MaxiTicket s.r.o., Drevárska 23, 902 01 Pezinok, IČO 53251580 — eticketo.eu
$telo$,
       published = false,
       updated_at = now()
 where slug = 'reklamacny-poriadok';

update public.site_pages
   set title = 'Ochrana osobných údajov',
       meta_description = 'Aké osobné údaje spracúvame pri predaji vstupeniek, na akom základe a aké máš práva.',
       body = $telo$Účinné od 1. 7. 2022. Tento dokument bol vyčlenený z článku 8 Všeobecných obchodných podmienok: eticketo.eu/p/obchodne-podmienky

8.1 MaxiTicket ako prevádzkovateľ internetovej stránky eticketo.eu a systému eticketo spracúva osobné údaje fyzických osôb - používateľov internetovej stránky/záujemcov o Podujatie a/alebo Majiteľov vstupenky (ďalej len „dotknuté osoby“) ako prevádzkovateľ v zmysle článku 4 ods. 7 Nariadenia GDPR.

8.2 Aby mohol záujemca o Podujatie využiť služby spoločnosti MaxiTicket, t.j. realizovať rezerváciu a/alebo kúpu Vstupenky na Podujatie prostredníctvom systému eticketo na internetovej stránke eticketo.eu, vrátane s tým súvisiacich úkonov (doručenie vstupeniek, vybavenie reklamácie, vrátenie vstupného a pod.), musí spoločnosti MaxiTicket oznámiť svoje osobné údaje, a to v rozsahu podľa zvolených/požadovaných služieb. Bez poskytnutia týchto osobných údajov nie je zo strany spoločnosti MaxiTicket možné služby systému eticketo záujemcovi o Podujatie a/alebo Majiteľovi vstupenky poskytnúť (napr. bez poskytnutia e-mailovej adresy nie je možné zaslať ticket@home alebo ticket2mobile vstupenky, bez poskytnutia čísla účtu nie je možné zrealizovať vrátenie vstupného za zrušené Podujatie Majiteľovi vstupenky a pod.). Účelom spracúvania osobných údajov dotknutých osôb je teda prevádzka systému eticketo a využitie jeho služieb. Vzhľadom na uvedené bude záujemca o Podujatie pred odoslaním objednávky vyzvaný, aby zaškrtnutím políčka potvrdil, že sa s týmito VOP oboznámil, prečítal ich, porozumel ich obsahu a v celom rozsahu s nimi súhlasí.

8.3 Za týmto účelom spracúva MaxiTicket osobné údaje dotknutých osôb v nasledovnom rozsahu: e-mailová adresa, meno a priezvisko, fakturačná adresa, telefónne číslo, informácie o objednávke (názov Podujatia, cena Vstupenky, číslo rezervácie, dátum úhrady, VS, druh Vstupenky, miesto v hľadisku), číslo účtu, príp. detail platby (v prípade, ak došlo k zrušeniu Podujatia a vráteniu vstupného prostredníctvom MaxiTicket), online identifikátory (cookies), v osobitných prípadoch (predovšetkým veľké športové podujatia) biometrické snímky tváre pri prechode turniketom.

8.4 MaxiTicket spracúva osobné údaje dotknutých osôb na základe svojho oprávneného záujmu v zmysle článku 6 ods. 1 písm. f) Nariadenia GDPR. Oprávneným záujmom spoločnosti MaxiTicket je zvýšenie využitia systému eticketo, t.j. podpora sprostredkovaného predaja Vstupeniek na Podujatia používateľom internetovej stránky eticketo.eu . Oprávneným záujmom spoločnosti MaxiTicket je aj vykonávanie priameho marketingu. Na tento účel MaxiTicket spracúva e-mailovú adresu dotknutej osoby. Spracúvané osobné údaje uchováva MaxiTicket po dobu trvania oprávneného záujmu, t.j. kým záujmy alebo základné práva a slobody dotknutej osoby neprevážia nad takýmito záujmami. Napríklad kým je dotknutá osoba aktívnym používateľom systému eticketo (stránky eticketo.eu). Zákonná povinnosť uchovávania údajov v lehote určenej osobitnými predpismi tým nie je dotknutá. Pre zaistenie určitých činností a/alebo operácií, ktoré MaxiTicket nedokáže zabezpečiť prostredníctvom vlastných zamestnancov, využíva služby iných subjektov. Na tieto účely sú osobné údaje sprístupnené týmto príjemcom: poskytovateľovi platobnej brány (spracovanie platby), poskytovateľovi odosielania e-mailov (doručenie vstupenky a oznámení), poskytovateľovi fakturácie (vystavenie dokladu) a poskytovateľovi hostingu a databázy.

## Organizátor podujatia ako prevádzkovateľ

Vstupenky sa predávajú v mene a na účet usporiadateľa podujatia, preto usporiadateľ dostáva údaje potrebné na jeho uskutočnenie — najmä meno, e-mail a údaje o objednávke. Vo vzťahu k týmto údajom je usporiadateľ samostatným prevádzkovateľom a zodpovedá za ich spracúvanie; svoje práva voči nemu môže dotknutá osoba uplatniť cez kontakt uvedený na stránke podujatia.

## Práva dotknutej osoby

Dotknutá osoba má právo na prístup k svojim údajom, na ich opravu, vymazanie, obmedzenie spracúvania, na prenosnosť, právo namietať proti spracúvaniu na základe oprávneného záujmu vrátane priameho marketingu, a právo podať návrh na začatie konania na Úrade na ochranu osobných údajov Slovenskej republiky. Žiadosti prijímame na podpora@eticketo.eu.

MaxiTicket s.r.o., Drevárska 23, 902 01 Pezinok, IČO 53251580 — eticketo.eu
$telo$,
       published = false,
       updated_at = now()
 where slug = 'ochrana-osobnych-udajov';

\echo ''
\echo '=== PO: koľko textu majú ==='
select slug, published, length(body) as znakov from public.site_pages order by sort_order;

\echo ''
\echo '--- kontrola: nezostala niekde stará adresa? (má byť 0) ---'
select count(*) as stare_adresy from public.site_pages where body ilike '%maxiticket.sk%';

\echo ''
\echo '--- kontrola: ostali nezverejnené? (musí byť 4) ---'
select count(*) as nezverejnenych from public.site_pages where not published;

-- Zmeň na `commit`, keď ti výpis sedí.
rollback;
