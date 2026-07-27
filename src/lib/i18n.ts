// Lightweight i18n for MaxiTicket — no external dependency.
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
  "common.addEvent": "Pridať podujatie",
  "common.openMenu": "Otvoriť menu",
  "common.closeMenu": "Zavrieť menu",
  "common.language": "Jazyk",
  // nav
  "nav.events": "Podujatia",
  "nav.cities": "Mestá",
  "nav.artists": "Umelci",
  "nav.marketing": "Marketing",
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
  "footer.tagline": "Najmodernejšia ticketing platforma na Slovensku. Predávame zážitky od roku 2025.",
  "footer.rights": "© 2026 vstupenky.sk s.r.o. — Všetky práva vyhradené.",
  "footer.builtWith": "Postavené s vášňou v Bratislave 🇸🇰",
};

const en: Dict = {
  "common.login": "Sign in",
  "common.logout": "Sign out",
  "common.account": "Account",
  "common.scannerQR": "QR Scanner",
  "common.addEvent": "Add event",
  "common.openMenu": "Open menu",
  "common.closeMenu": "Close menu",
  "common.language": "Language",
  "nav.events": "Events",
  "nav.cities": "Cities",
  "nav.artists": "Artists",
  "nav.marketing": "Marketing",
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
  "footer.tagline": "The most modern ticketing platform in Slovakia. Selling experiences since 2025.",
  "footer.rights": "© 2026 vstupenky.sk s.r.o. — All rights reserved.",
  "footer.builtWith": "Built with passion in Bratislava 🇸🇰",
};

const de: Dict = {
  "common.login": "Anmelden",
  "common.logout": "Abmelden",
  "common.account": "Konto",
  "common.scannerQR": "QR-Scanner",
  "common.addEvent": "Event hinzufügen",
  "common.openMenu": "Menü öffnen",
  "common.closeMenu": "Menü schließen",
  "common.language": "Sprache",
  "nav.events": "Veranstaltungen",
  "nav.cities": "Städte",
  "nav.artists": "Künstler",
  "nav.marketing": "Marketing",
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
  "footer.tagline": "Die modernste Ticketing-Plattform der Slowakei. Wir verkaufen Erlebnisse seit 2025.",
  "footer.rights": "© 2026 vstupenky.sk s.r.o. — Alle Rechte vorbehalten.",
  "footer.builtWith": "Mit Leidenschaft in Bratislava gebaut 🇸🇰",
};

const hu: Dict = {
  "common.login": "Bejelentkezés",
  "common.logout": "Kijelentkezés",
  "common.account": "Fiók",
  "common.scannerQR": "QR-olvasó",
  "common.addEvent": "Esemény hozzáadása",
  "common.openMenu": "Menü megnyitása",
  "common.closeMenu": "Menü bezárása",
  "common.language": "Nyelv",
  "nav.events": "Események",
  "nav.cities": "Városok",
  "nav.artists": "Előadók",
  "nav.marketing": "Marketing",
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
  "footer.tagline": "Szlovákia legmodernebb jegyértékesítő platformja. 2025 óta élményeket árulunk.",
  "footer.rights": "© 2026 vstupenky.sk s.r.o. — Minden jog fenntartva.",
  "footer.builtWith": "Szenvedéllyel készült Pozsonyban 🇸🇰",
};

export const translations: Record<Lang, Dict> = { sk, en, de, hu };

export function translate(lang: Lang, key: string, vars?: Record<string, string | number>): string {
  const raw = translations[lang]?.[key] ?? translations.sk[key] ?? key;
  if (!vars) return raw;
  return raw.replace(/\{\{(\w+)\}\}/g, (_, k: string) => (vars[k] != null ? String(vars[k]) : `{{${k}}}`));
}
