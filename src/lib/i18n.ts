// Lightweight i18n for eTicketo — no external dependency.
//
// Languages: Slovak (default), English, German, Hungarian.
// Keys are flat dot-paths (e.g. "nav.events"). Use interpolation with
// {{name}} placeholders and pass vars to t(): t("hello", { name: "Jano" }).
//
// HOW TO EXTEND: add the key to every language object below. Missing keys fall
// back to Slovak, then to the raw key, so the app never shows blank text.

export const LANGS = ["sk", "en", "de", "hu"] as const;
export type Lang = (typeof LANGS)[number];

export const LANG_LABELS: Record<Lang, string> = {
  sk: "Slovenčina",
  en: "English",
  de: "Deutsch",
  hu: "Magyar",
};

export const LANG_FLAGS: Record<Lang, string> = {
  sk: "🇸🇰",
  en: "🇬🇧",
  de: "🇩🇪",
  hu: "🇭🇺",
};

type Dict = Record<string, string>;

const sk: Dict = {
  // common
  "common.login": "Prihlásiť sa",
  "common.logout": "Odhlásiť",
  "common.account": "Účet",
  "common.scannerQR": "Čítačka QR",
  "common.openMenu": "Otvoriť menu",
  "common.closeMenu": "Zavrieť menu",
  "common.language": "Jazyk",
  // nav
  "nav.events": "Podujatia",
  "nav.cities": "Mestá",
  "nav.artists": "Umelci",
  "nav.support": "Podpora",
  "nav.partners": "Spolupráca",
  "nav.contact": "Kontakt",
  // footer
  "footer.platform": "Platforma",
  "footer.company": "Spoločnosť",
  "footer.account": "Účet",
  "footer.partners": "Partneri",
  "footer.forOrganizers": "Pre organizátorov",
  "footer.about": "O nás",
  "footer.login": "Prihlásenie",
  "footer.register": "Registrácia",
  "footer.myAccount": "Môj účet",
  "footer.tagline":
    "Slovenská platforma na predaj vstupeniek. Vstupenka s QR kódom ti príde e-mailom hneď po zaplatení.",
  "footer.rights": "© 2026 eticketo.eu — Všetky práva vyhradené.",
  "footer.builtWith": "Postavené s vášňou na Slovensku 🇸🇰",
  // support chat
  "support.title": "Podpora",
  "support.subtitle": "Asistent · odpovie hneď",
  "support.greeting":
    "Ahoj! 👋 Poradím s nákupom, platbou, vstupenkami aj so vstupom na podujatie. S konkrétnou objednávkou ti pomôže kolega na kontakte — ja do nej nevidím.",
  "support.placeholder": "Napíš svoju otázku…",
  "support.send": "Odoslať",
  "support.thinking": "Píšem…",
  "support.disabled": "Na toto ti odpovie kolega — napíš nám prosím cez Kontakt.",
  "support.error": "Prepáč, niečo sa pokazilo. Skús to prosím znova.",
  "support.contactCta": "Kontaktovať ľudskú podporu",
};

const en: Dict = {
  "common.login": "Sign in",
  "common.logout": "Sign out",
  "common.account": "Account",
  "common.scannerQR": "QR Scanner",
  "common.openMenu": "Open menu",
  "common.closeMenu": "Close menu",
  "common.language": "Language",
  "nav.events": "Events",
  "nav.cities": "Cities",
  "nav.artists": "Artists",
  "nav.support": "Support",
  "nav.partners": "Partnership",
  "nav.contact": "Contact",
  "footer.platform": "Platform",
  "footer.company": "Company",
  "footer.account": "Account",
  "footer.partners": "Partners",
  "footer.forOrganizers": "For organizers",
  "footer.about": "About us",
  "footer.login": "Sign in",
  "footer.register": "Sign up",
  "footer.myAccount": "My account",
  "footer.tagline":
    "A Slovak ticketing platform. Your ticket with a QR code arrives by e-mail right after payment.",
  "footer.rights": "© 2026 eticketo.eu — All rights reserved.",
  "footer.builtWith": "Built with passion in Slovakia 🇸🇰",
  "support.title": "Support",
  "support.subtitle": "Assistant · instant replies",
  "support.greeting":
    "Hi! 👋 I can help with buying, payment, tickets and getting in at the door. For a specific order a colleague on the contact page will help — I cannot see into it.",
  "support.placeholder": "Type your question…",
  "support.send": "Send",
  "support.thinking": "Typing…",
  "support.disabled": "A colleague will answer this one — please reach us via Contact.",
  "support.error": "Sorry, something went wrong. Please try again.",
  "support.contactCta": "Contact human support",
};

const de: Dict = {
  "common.login": "Anmelden",
  "common.logout": "Abmelden",
  "common.account": "Konto",
  "common.scannerQR": "QR-Scanner",
  "common.openMenu": "Menü öffnen",
  "common.closeMenu": "Menü schließen",
  "common.language": "Sprache",
  "nav.events": "Veranstaltungen",
  "nav.cities": "Städte",
  "nav.artists": "Künstler",
  "nav.support": "Support",
  "nav.partners": "Partnerschaft",
  "nav.contact": "Kontakt",
  "footer.platform": "Plattform",
  "footer.company": "Unternehmen",
  "footer.account": "Konto",
  "footer.partners": "Partner",
  "footer.forOrganizers": "Für Veranstalter",
  "footer.about": "Über uns",
  "footer.login": "Anmeldung",
  "footer.register": "Registrierung",
  "footer.myAccount": "Mein Konto",
  "footer.tagline":
    "Eine slowakische Ticketing-Plattform. Das Ticket mit QR-Code kommt direkt nach der Zahlung per E-Mail.",
  "footer.rights": "© 2026 eticketo.eu — Alle Rechte vorbehalten.",
  "footer.builtWith": "Mit Leidenschaft in der Slowakei gebaut 🇸🇰",
  "support.title": "Support",
  "support.subtitle": "Assistent · sofortige Antwort",
  "support.greeting":
    "Hallo! 👋 Ich helfe beim Kauf, bei der Zahlung, bei Tickets und beim Einlass. Zu einer konkreten Bestellung hilft eine Kollegin oder ein Kollege über die Kontaktseite — ich sehe nicht hinein.",
  "support.placeholder": "Schreib deine Frage…",
  "support.send": "Senden",
  "support.thinking": "Schreibt…",
  "support.disabled":
    "Das beantwortet dir am besten eine Kollegin oder ein Kollege — bitte über Kontakt melden.",
  "support.error": "Entschuldigung, etwas ist schiefgelaufen. Bitte versuche es erneut.",
  "support.contactCta": "Menschlichen Support kontaktieren",
};

const hu: Dict = {
  "common.login": "Bejelentkezés",
  "common.logout": "Kijelentkezés",
  "common.account": "Fiók",
  "common.scannerQR": "QR-olvasó",
  "common.openMenu": "Menü megnyitása",
  "common.closeMenu": "Menü bezárása",
  "common.language": "Nyelv",
  "nav.events": "Események",
  "nav.cities": "Városok",
  "nav.artists": "Előadók",
  "nav.support": "Támogatás",
  "nav.partners": "Együttműködés",
  "nav.contact": "Kapcsolat",
  "footer.platform": "Platform",
  "footer.company": "Cég",
  "footer.account": "Fiók",
  "footer.partners": "Partnerek",
  "footer.forOrganizers": "Szervezőknek",
  "footer.about": "Rólunk",
  "footer.login": "Bejelentkezés",
  "footer.register": "Regisztráció",
  "footer.myAccount": "Fiókom",
  "footer.tagline":
    "Szlovák jegyértékesítő platform. A QR-kódos jegy fizetés után azonnal megérkezik e-mailben.",
  "footer.rights": "© 2026 eticketo.eu — Minden jog fenntartva.",
  "footer.builtWith": "Szenvedéllyel készült Szlovákiában 🇸🇰",
  "support.title": "Támogatás",
  "support.subtitle": "Asszisztens · azonnali válasz",
  "support.greeting":
    "Szia! 👋 Segítek a vásárlásban, a fizetésben, a jegyekkel és a belépéssel. Konkrét rendelésben a kapcsolat oldalon érhető el kolléga — abba én nem látok bele.",
  "support.placeholder": "Írd be a kérdésed…",
  "support.send": "Küldés",
  "support.thinking": "Gépel…",
  "support.disabled": "Erre egy kolléga tud válaszolni — kérjük, írj nekünk a Kapcsolat oldalon.",
  "support.error": "Elnézést, valami elromlott. Kérjük, próbáld újra.",
  "support.contactCta": "Emberi ügyfélszolgálat",
};

// Page-level translations produced by the batch i18n conversion live in a
// separate generated file and are merged on top of the base dictionary above.
import { generated } from "./i18n.generated";

export const translations: Record<Lang, Dict> = {
  sk: { ...sk, ...generated.sk },
  en: { ...en, ...generated.en },
  de: { ...de, ...generated.de },
  hu: { ...hu, ...generated.hu },
};

// Premenné smú byť aj null/undefined — volajúci často posiela hodnotu z
// voliteľného objektu (napr. `detail?.receipt_number`). Odovzdaný kľúč s
// prázdnou hodnotou sa nahradí prázdnym reťazcom; neodovzdaný kľúč necháva
// placeholder viditeľný, aby sa chýbajúca premenná dala odhaliť.
export type TranslateVars = Record<string, string | number | null | undefined>;

export function translate(lang: Lang, key: string, vars?: TranslateVars): string {
  const raw = translations[lang]?.[key] ?? translations.sk[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (_, k: string) => {
    if (!(k in vars)) return `{{${k}}}`;
    return vars[k] != null ? String(vars[k]) : "";
  });
}
