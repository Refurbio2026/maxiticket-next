// Čo asistent vie o eticketo.eu — jediný zdroj faktov.
//
// Ten istý zoznam slúži dvakrát:
//   1. ako znalostná báza pre AI (`znalostiText`),
//   2. ako odpovede, keď AI nie je nastavená (`odpovedBezAI`).
// Vďaka tomu sa nemôže stať, že si tieto dve vetvy protirečia.
//
// PRAVIDLO: každé tvrdenie tu musí platiť dnes. Predchádzajúca verzia
// sľubovala platbu cez GoPay, faktúru zo SuperFaktúry a vstupenku do Apple
// Wallet — nič z toho nebola pravda a asistent to hovoril zákazníkom
// s úplnou istotou.
import { PREVADZKOVATEL } from "@/lib/kontakt";

export type Jazyk = "sk" | "en" | "de" | "hu";

export type Tema = {
  id: string;
  /**
   * Slová, podľa ktorých sa téma pozná v otázke. Píšu sa malými písmenami
   * a bez diakritiky — otázka sa normalizuje rovnako, takže „faktúru"
   * aj „fakturu" nájdu to isté.
   */
  kluce: string[];
  otazka: Record<"sk" | "en", string>;
  odpoved: Record<"sk" | "en", string>;
  /** Kam poslať za podrobnosťami. */
  odkaz?: { cesta: string; text: Record<"sk" | "en", string> };
};

export const TEMY: Tema[] = [
  {
    id: "dorucenie",
    kluce: [
      "kedy pride",
      "pride vstupenk",
      "pride listok",
      "dostanem vstupenk",
      "neprisla",
      "nedostal",
      "neprisiel",
      "dorucenie",
      "poslali",
      "kde mam vstupenku",
      "nemam vstupenku",
      "email",
      "mail",
      "spam",
      "ticket",
      "delivery",
      "receive",
      "arrive",
      "not received",
    ],
    otazka: {
      sk: "Kedy mi príde vstupenka?",
      en: "When will I get my ticket?",
    },
    odpoved: {
      sk: "Hneď po zaplatení — vstupenku s QR kódom pošleme na e-mail, ktorý si zadal v objednávke, a nájdeš ju aj po prihlásení v sekcii Moje vstupenky. Ak v schránke nič nie je: pozri priečinok Spam alebo Promo akcie a over, či si pri nákupe nezadal preklep v adrese. Pri platbe prevodom vstupenku vydáme až po pripísaní peňazí, to môže trvať aj deň či dva.",
      en: "Right after payment — we e-mail the ticket with its QR code to the address you entered, and you will also find it under My tickets once you sign in. If nothing arrived, check your Spam or Promotions folder and make sure there was no typo in the address. With a bank transfer the ticket is issued only once the money arrives, which can take a day or two.",
    },
    odkaz: { cesta: "/account", text: { sk: "Moje vstupenky", en: "My tickets" } },
  },
  {
    id: "platba",
    kluce: [
      "platba",
      "zaplatit",
      "platit",
      "karta",
      "kartou",
      "prevod",
      "banka",
      "platobne",
      "sposob platby",
      "apple pay",
      "google pay",
      "payment",
      "pay",
      "card",
      "transfer",
    ],
    otazka: { sk: "Ako sa dá zaplatiť?", en: "How can I pay?" },
    odpoved: {
      sk: "Platobnou kartou (Visa, Mastercard) alebo bankovým prevodom cez platobnú bránu. Údaje z karty sa k nám nikdy nedostanú, spracúva ich priamo banka. Kartou máš vstupenku okamžite; pri prevode ju vydáme po pripísaní platby. Cena, ktorú vidíš pri vstupenke, je konečná — nepripočítavame k nej žiadny servisný poplatok.",
      en: "By card (Visa, Mastercard) or by bank transfer through the payment gateway. Card details never reach us — the bank handles them. Paying by card gets you the ticket immediately; with a transfer we issue it once the payment arrives. The price shown with the ticket is final, we add no service fee on top.",
    },
  },
  {
    id: "faktura",
    kluce: [
      "faktura",
      "fakturu",
      "doklad",
      "ico",
      "firmu",
      "firemne",
      "na firmu",
      "dph",
      "ic dph",
      "invoice",
      "receipt",
      "company",
      "vat",
    ],
    otazka: { sk: "Dostanem faktúru?", en: "Will I get an invoice?" },
    odpoved: {
      sk: "Pri nákupe na firmu áno. V objednávke prepni na firemné údaje a zadaj IČO — názov, adresu a daňové čísla si vieme dotiahnuť z registra, takže ich neprepisuješ ručne. Faktúru potom pošleme e-mailom. Fyzickým osobám faktúru nevystavujeme, dokladom je potvrdenie objednávky spolu s vstupenkou.",
      en: "If you buy as a company, yes. Switch to company details in the order and enter the company ID — we can pull the name, address and tax numbers from the business register for you. The invoice then arrives by e-mail. For private individuals we do not issue invoices; the order confirmation with the ticket is your proof of purchase.",
    },
  },
  {
    id: "prenos",
    kluce: [
      "preniest",
      "prenos",
      "poslat kamaratovi",
      "darovat",
      "niekomu inemu",
      "prepisat",
      "ine meno",
      "transfer ticket",
      "give",
      "friend",
      "name change",
    ],
    otazka: {
      sk: "Môžem vstupenku dať niekomu inému?",
      en: "Can I pass my ticket to someone else?",
    },
    odpoved: {
      sk: "Áno. Vstupenku jednoducho prepošli ďalej — pri vchode platí QR kód, nie meno, a platný je pre toho, kto ho použije ako prvý. Dávaj preto pozor, komu ju posielaš, a nezverejňuj QR kód na sociálnych sieťach. Ak je vstupenka vydaná na konkrétne meno, zmenu treba dohodnúť priamo s usporiadateľom podujatia.",
      en: "Yes. Just forward it — at the entrance the QR code counts, not the name, and it is valid for whoever uses it first. So be careful who you send it to and never post the QR code publicly. If the ticket was issued to a specific name, the change has to be agreed with the event organiser.",
    },
  },
  {
    id: "vstup",
    // Pozor na „vstup": je to začiatok slova „vstupenka" a zobralo by si
    // otázky o doručení. Preto sú tu len tvary o vstupovaní do sály.
    kluce: [
      "vchod",
      "pri vstupe",
      "na vstupe",
      "skenov",
      "qr kod",
      "tlacit",
      "vytlacit",
      "nefunguje kod",
      "entry",
      "scan",
      "print",
      "gate",
      "door",
    ],
    otazka: { sk: "Ako sa dostanem na podujatie?", en: "How do I get in?" },
    odpoved: {
      sk: "Pri vchode stačí ukázať QR kód v mobile, tlačiť nič netreba. Každý kód platí na jeden vstup — keď ho niekto použije, druhýkrát už neprejde. Ak kód nejde načítať (rozbitý displej, slabý signál), oslov personál na vstupe alebo zavolaj nám, overíme ťa podľa e-mailu z objednávky.",
      en: "Just show the QR code on your phone at the entrance, no printing needed. Each code is valid for one entry — once it is used it will not work again. If the code cannot be read (cracked screen, poor signal), talk to the staff at the door or call us and we will verify you by the e-mail from your order.",
    },
  },
  {
    id: "zrusene",
    kluce: [
      "zrusene",
      "zrusili",
      "zrusenie",
      "presunute",
      "preslozili",
      "novy termin",
      "odlozene",
      "cancelled",
      "postponed",
      "moved",
    ],
    otazka: {
      sk: "Podujatie zrušili — čo teraz?",
      en: "The event was cancelled — what now?",
    },
    odpoved: {
      sk: "Dáme ti vedieť e-mailom a zverejníme postup vrátenia vstupného vrátane kontaktu, cez ktorý bude prebiehať. Presne to popisuje bod 3.7 obchodných podmienok. Pri presunutom termíne vstupenka spravidla platí aj na nový dátum — rozhoduje usporiadateľ a dozvieš sa to v tom istom e-maile.",
      en: "We will let you know by e-mail and publish how the refund will be handled, including the contact for it. Clause 3.7 of the terms describes it. If the event is only moved, the ticket usually stays valid for the new date — that is the organiser's call and the same e-mail will say so.",
    },
    odkaz: {
      cesta: "/p/obchodne-podmienky",
      text: { sk: "Obchodné podmienky", en: "Terms and conditions" },
    },
  },
  {
    id: "vratenie",
    kluce: [
      "vratit",
      "vratenie penazi",
      "refund",
      "storno",
      "stornovat",
      "nemozem prist",
      "zrusit objednavku",
      "peniaze spat",
      "money back",
      "cancel order",
    ],
    otazka: {
      sk: "Môžem vstupenku vrátiť, keď nemôžem prísť?",
      en: "Can I return a ticket if I cannot come?",
    },
    odpoved: {
      sk: "Žiaľ nie. Nákup vstupenky na podujatie sa nedá stornovať ako bežný tovar z e-shopu — zákon pri službách viazaných na dohodnutý termín odstúpenie od zmluvy nedáva (§ 7 ods. 6 zákona č. 102/2014 Z. z.) a rovnako to máme aj v obchodných podmienkach. Vstupenku však môžeš poslať ďalej, pri vchode platí QR kód, nie meno.",
      en: "Unfortunately not. Buying a ticket cannot be withdrawn like ordinary goods from an e-shop — for services tied to a specific date the law gives no right of withdrawal (§ 7(6) of Act 102/2014 Coll.), and our terms say the same. You can, however, pass the ticket on: at the entrance the QR code counts, not the name.",
    },
  },
  {
    id: "ucet",
    kluce: [
      "ucet",
      "prihlasit",
      "prihlasenie",
      "registracia",
      "heslo",
      "moje vstupenk",
      "svoje vstupenk",
      "kde najdem",
      "kde su moje",
      "stiahnut vstupenk",
      "account",
      "login",
      "sign in",
      "password",
      "register",
      "my tickets",
    ],
    otazka: { sk: "Kde nájdem svoje vstupenky?", en: "Where do I find my tickets?" },
    odpoved: {
      sk: "Po prihlásení v sekcii Moje vstupenky. Zobrazujú sa podľa e-mailu, ktorý si použil pri nákupe — ak si kupoval na inú adresu, než máš v účte, prihlás sa tou pôvodnou alebo nám napíš a spojíme to. Vstupenku vieš z účtu kedykoľvek znova stiahnuť alebo poslať na e-mail.",
      en: "Under My tickets once you sign in. They are matched by the e-mail you used when buying — if that differs from the one on your account, sign in with the original one or write to us and we will link them. From the account you can download the ticket again or re-send it by e-mail at any time.",
    },
    odkaz: { cesta: "/account", text: { sk: "Moje vstupenky", en: "My tickets" } },
  },
  {
    id: "ponuka",
    kluce: [
      "ake podujatia",
      "co hrate",
      "program",
      "koncerty",
      "co sa deje",
      "podujatia",
      "listky na",
      "events",
      "what is on",
      "shows",
    ],
    otazka: { sk: "Aké podujatia máte?", en: "What events do you have?" },
    odpoved: {
      sk: "Všetko, čo je práve v predaji, nájdeš v sekcii Podujatia — dá sa filtrovať podľa mesta, dátumu aj kategórie.",
      en: "Everything currently on sale is in the Events section — you can filter by city, date and category.",
    },
    odkaz: { cesta: "/events", text: { sk: "Podujatia", en: "Events" } },
  },
  {
    id: "organizator",
    kluce: [
      "organizator",
      "organizovat",
      "predavat vstupenky",
      "moje podujatie",
      "chcem predavat",
      "provizia",
      "poplatky pre organizatorov",
      "pokladna",
      "organiser",
      "organizer",
      "sell tickets",
      "commission",
    ],
    otazka: {
      sk: "Chcem cez vás predávať vstupenky.",
      en: "I want to sell tickets through you.",
    },
    odpoved: {
      sk: "Rád. Registrácia organizátora je cez sprievodcu — vyplníš údaje o sebe a o podujatí a my prístup potvrdíme. Platíš 10 % z ceny predanej vstupenky, žiadne mesačné poplatky ani platbu za zriadenie; pri väčšom objeme sa vieme dohodnúť individuálne. K tomu dostaneš pokladňu na predaj priamo na mieste, čítačku na QR kódy pri vchode a kód, ktorým si predaj vložíš na vlastný web.",
      en: "Glad to hear it. Organiser sign-up goes through a guided form — you fill in your details and the event, and we confirm the access. You pay 10 % of each ticket sold, with no monthly or setup fees; for larger volumes we can agree on individual terms. You also get an on-site point of sale, a QR scanner for the door, and a snippet to sell tickets from your own website.",
    },
    odkaz: {
      cesta: "/onboarding",
      text: { sk: "Registrácia organizátora", en: "Organiser sign-up" },
    },
  },
  {
    id: "kontakt",
    kluce: [
      "kontakt",
      "telefon",
      "zavolat",
      "napisat",
      "clovek",
      "operator",
      "pomoc",
      "reklamacia",
      "staznost",
      "contact",
      "phone",
      "human",
      "complaint",
    ],
    otazka: { sk: "Ako vás zastihnem?", en: "How do I reach you?" },
    odpoved: {
      sk: `Napíš na ${PREVADZKOVATEL.email} alebo zavolaj na ${PREVADZKOVATEL.telefon}. Ak ide o konkrétnu objednávku, prilož prosím e-mail, na ktorý bola, a číslo objednávky — nájdeme ju hneď. Reklamácie prijímame na tej istej adrese.`,
      en: `Write to ${PREVADZKOVATEL.email} or call ${PREVADZKOVATEL.telefon}. If it is about a specific order, please include the e-mail it was placed with and the order number so we can find it right away. Complaints go to the same address.`,
    },
    odkaz: { cesta: "/contact", text: { sk: "Kontakt", en: "Contact" } },
  },
  {
    id: "bezpecnost",
    kluce: [
      "bezpecne",
      "podvod",
      "falosna",
      "overit",
      "dovera",
      "osobne udaje",
      "gdpr",
      "safe",
      "scam",
      "fake",
      "privacy",
      "data",
    ],
    otazka: {
      sk: "Je nákup u vás bezpečný?",
      en: "Is buying from you safe?",
    },
    odpoved: {
      sk: "Platbu spracúva platobná brána, takže číslo karty sa k nám vôbec nedostane. Každá vstupenka má podpísaný QR kód, ktorý sa pri vchode overuje proti našej databáze, takže kópia z internetu neprejde. Ako nakladáme s osobnými údajmi, je napísané v Ochrane osobných údajov.",
      en: "Payments run through the payment gateway, so your card number never reaches us. Every ticket carries a signed QR code checked against our database at the door, so a copy found online will not get anyone in. How we handle personal data is described in the privacy policy.",
    },
    odkaz: {
      cesta: "/p/ochrana-osobnych-udajov",
      text: { sk: "Ochrana osobných údajov", en: "Privacy policy" },
    },
  },
];

/** „Faktúru" → „fakturu". Nech sa otázka nájde aj bez mäkčeňov. */
export function bezDiakritiky(text: string): string {
  return text.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
}

/** Otázka na porovnávanie: bez diakritiky, bez interpunkcie, slová medzerami. */
function naSlova(text: string): string {
  return ` ${bezDiakritiky(text)
    .replace(/[^a-z0-9]+/g, " ")
    .trim()} `;
}

/**
 * Téma, ktorej sa otázka najviac podobá.
 *
 * Skóre je súčet dĺžok kľúčov, ktoré sa v otázke našli — dlhšia zhoda
 * („zrusit objednavku") váži viac než krátka („qr"). Pod hranicou radšej
 * nehádame a vrátime `null`; zlá odpoveď je horšia než priznané „neviem".
 */
export function najdiTemu(otazka: string): Tema | null {
  const text = naSlova(otazka);
  let najlepsia: { tema: Tema; skore: number } | null = null;

  for (const tema of TEMY) {
    let skore = 0;
    for (const kluc of tema.kluce) {
      // Kľúč musí začínať na začiatku slova. Bez tejto podmienky by sa
      // „vstup" našlo uprostred „vstupenka" a otázka „kedy mi príde
      // vstupenka" by skončila pri odpovedi o vchode do sály.
      if (text.includes(` ${kluc}`)) skore += kluc.length;
    }
    if (skore > 0 && (!najlepsia || skore > najlepsia.skore)) najlepsia = { tema, skore };
  }

  return najlepsia && najlepsia.skore >= 3 ? najlepsia.tema : null;
}

/** Nemčina ani maďarčina vlastné znenie nemajú — tam ide anglické. */
function text(hodnoty: Record<"sk" | "en", string>, jazyk: Jazyk): string {
  return jazyk === "sk" ? hodnoty.sk : hodnoty.en;
}

export type OdpovedBezAI = {
  text: string;
  /** Téma, ktorú sme rozpoznali; `null` = nevieme a posielame na kontakt. */
  temaId: string | null;
};

/**
 * Odpoveď bez AI.
 *
 * Používa sa, kým nie je vložený kľúč k modelu, a aj keď model zlyhá —
 * návštevník nemá vidieť technickú hlášku, ale odpoveď na svoju otázku.
 */
export function odpovedBezAI(otazka: string, jazyk: Jazyk): OdpovedBezAI {
  const tema = najdiTemu(otazka);
  if (!tema) {
    return {
      temaId: null,
      text:
        jazyk === "sk"
          ? `Toto si netrúfam zodpovedať tak, aby som ťa nepomýlil. Napíš nám prosím na ${PREVADZKOVATEL.email} alebo zavolaj na ${PREVADZKOVATEL.telefon} — ak ide o objednávku, pripíš e-mail, na ktorý bola.`
          : `I would rather not guess at this one. Please write to ${PREVADZKOVATEL.email} or call ${PREVADZKOVATEL.telefon} — if it is about an order, include the e-mail it was placed with.`,
    };
  }

  // Cesta bez domény — widget ju vykreslí ako klikací odkaz v aplikácii.
  const odkaz = tema.odkaz ? `\n\n${text(tema.odkaz.text, jazyk)}: ${tema.odkaz.cesta}` : "";
  return { temaId: tema.id, text: text(tema.odpoved, jazyk) + odkaz };
}

/** Znalostná báza pre model — tie isté fakty, len pokope. */
export function znalostiText(): string {
  const casti = TEMY.map((t) => {
    const odkaz = t.odkaz ? `\nODKAZ: ${t.odkaz.cesta} (${t.odkaz.text.sk})` : "";
    return `OTÁZKA: ${t.otazka.sk}\nODPOVEĎ: ${t.odpoved.sk}${odkaz}`;
  });
  return casti.join("\n\n");
}
