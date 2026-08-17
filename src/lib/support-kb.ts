// Knowledge base for the customer-support assistant. Written in Slovak; the
// model is instructed to answer in the visitor's chosen language. Keep facts
// here accurate to the platform — the bot must not invent policies.

export const SUPPORT_KB = `
PLATFORMA
- vipky.sk (MaxiTicket) je online platforma na predaj vstupeniek na podujatia (koncerty, festivaly, šport, divadlo, stand-up, kultúra) na Slovensku.

AKO KÚPIŤ VSTUPENKU
1. Na stránke Podujatia si vyber podujatie.
2. Zvoľ typ vstupenky / sedadlo a počet.
3. Prejdi do pokladne (checkout), vyplň meno, priezvisko a email (naň prídu vstupenky).
4. Zaplať cez bránu GoPay.
5. Po úspešnej platbe sa zobrazí stránka s QR vstupenkami; potvrdenie príde aj na email.

PLATOBNÉ MOŽNOSTI
- Platby spracúva GoPay: platobná karta, Apple Pay, Google Pay, bankové tlačidlá (prevod) a GoPay účet.

VSTUPENKY A VSTUP NA PODUJATIE
- Vstupenka je QR kód. Netreba tlačiť — stačí ukázať QR z mobilu pri vstupe.
- Vstupenku sa dá stiahnuť ako PDF a poslať na email.
- Vstupenku si možno pridať do Apple Wallet alebo Google Wallet (ak je táto možnosť pri podujatí aktívna).
- Pri vstupe organizátor naskenuje QR; každá vstupenka platí spravidla na jeden vstup.

FAKTÚRA / DOKLAD
- K objednávke sa vystavuje doklad cez SuperFaktúru; odkaz na PDF faktúry je na stránke po nákupe.

MÔJ ÚČET / MOJE VSTUPENKY
- Po prihlásení v sekcii Môj účet vidíš svoje zaplatené vstupenky. Zobrazujú sa podľa emailu, ktorý si použil pri nákupe — preto pri kúpe zadaj rovnaký email ako máš v účte.

REKLAMÁCIE, ZMENY A VRÁTENIE PEŇAZÍ
- Vrátenie peňazí a zmeny (napr. zrušené alebo presunuté podujatie) závisia od podmienok konkrétneho organizátora.
- Refund vie spracovať administrátor/organizátor; ak potrebuješ vrátenie alebo zmenu, kontaktuj podporu a uveď číslo objednávky a email.

NENAŠIEL SOM VSTUPENKY V EMAILI
- Skontroluj priečinok Spam/Promócie. Over, či si pri nákupe zadal správny email. Vstupenky nájdeš aj v sekcii Môj účet po prihlásení.

PRE ORGANIZÁTOROV
- Organizátori môžu pridávať a spravovať podujatia, predávať cez POS pokladňu a sledovať predaje. Registrácia je cez Registráciu (typ účtu Organizátor); prístup organizátora potvrdzuje administrátor.

KONTAKT
- Ak asistent nevie pomôcť alebo ide o konkrétnu objednávku, nasmeruj používateľa na stránku Kontakt (/contact), kde nájde kontaktné údaje na ľudskú podporu.

ČO ASISTENT NEVIE
- Asistent nemá prístup k údajom konkrétnej objednávky ani k účtu používateľa. Nevymýšľa čísla objednávok, ceny ani termíny. Pri otázkach na konkrétnu objednávku poradí, kde si to používateľ nájde, alebo odporučí kontakt.
`;
