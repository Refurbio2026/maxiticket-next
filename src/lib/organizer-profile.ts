// Čisté pravidlá organizátorského profilu — bez databázy, nech ich vie použiť
// sprievodca v prehliadači aj server, a nech sa dajú otestovať.

/** Stav organizátorského účtu; zodpovedá enumu `organizer_status` v databáze. */
export type OrganizerStatus =
  "none" | "onboarding" | "pending" | "approved" | "rejected" | "suspended";

export const ORGANIZER_STATUS_LABEL: Record<OrganizerStatus, string> = {
  none: "bežný účet",
  onboarding: "rozpracovaná registrácia",
  pending: "čaká na schválenie",
  approved: "schválený",
  rejected: "zamietnutý",
  suspended: "pozastavený",
};

// Tvar a rezervované názvy adresy sú v `subdomena.ts` — jedna adresa, jedno
// pravidlo. Tu je len to, čo k nemu patrí navyše: siete, IBAN a kontrola, či je
// profil pripravený.

/** Sociálne siete, ktoré si organizátor môže pripojiť. Poradie určuje zobrazenie. */
export const LINK_PLATFORMS = [
  { key: "facebook", label: "Facebook", hint: "https://facebook.com/tvojastranka" },
  { key: "instagram", label: "Instagram", hint: "https://instagram.com/tvojprofil" },
  { key: "youtube", label: "YouTube", hint: "https://youtube.com/@kanal" },
  { key: "tiktok", label: "TikTok", hint: "https://tiktok.com/@profil" },
  { key: "x", label: "X / Twitter", hint: "https://x.com/profil" },
  { key: "linkedin", label: "LinkedIn", hint: "https://linkedin.com/company/firma" },
  { key: "spotify", label: "Spotify", hint: "https://open.spotify.com/artist/…" },
  { key: "bandcamp", label: "Bandcamp", hint: "https://profil.bandcamp.com" },
  { key: "soundcloud", label: "SoundCloud", hint: "https://soundcloud.com/profil" },
  { key: "threads", label: "Threads", hint: "https://threads.net/@profil" },
  { key: "telegram", label: "Telegram", hint: "https://t.me/kanal" },
] as const;

export type LinkPlatform = (typeof LINK_PLATFORMS)[number]["key"];

export const LINK_PLATFORM_KEYS = LINK_PLATFORMS.map((p) => p.key) as LinkPlatform[];

/** Verzia VOP, ktorú organizátor odklikáva v sprievodcovi. */
export const TERMS_VERSION = "2026-10";

/**
 * Kontrola IBAN podľa mod-97 (ISO 13616). Zlý IBAN sa inak ukáže až tým, že
 * organizátorovi nedorazí výplata.
 */
export function platnyIban(iban: string): boolean {
  const s = iban.replace(/[\s-]/g, "").toUpperCase();
  if (!/^[A-Z]{2}[0-9]{2}[A-Z0-9]{10,30}$/.test(s)) return false;
  const presunute = s.slice(4) + s.slice(0, 4);
  let zvysok = 0;
  for (const ch of presunute) {
    const hodnota = ch >= "A" && ch <= "Z" ? String(ch.charCodeAt(0) - 55) : ch;
    for (const cislica of hodnota) {
      zvysok = (zvysok * 10 + Number(cislica)) % 97;
    }
  }
  return zvysok === 1;
}

/** IBAN po štvorčekoch, ako sa píše na papieri. */
export function formatujIban(iban: string): string {
  const s = iban.replace(/[\s-]/g, "").toUpperCase();
  return s.replace(/(.{4})/g, "$1 ").trim();
}

/** Údaje, z ktorých sa rozhoduje, či je profil pripravený. */
export type ProfilNaKontrolu = {
  display_name?: string | null;
  subdomain?: string | null;
  company_name?: string | null;
  ico?: string | null;
  billing_address?: string | null;
  phone?: string | null;
  terms_accepted_at?: string | null;
  payout_iban?: string | null;
  cancellation_policy?: string | null;
  complaint_contact?: string | null;
  logo_url?: string | null;
};

export type Nedostatok = { pole: string; popis: string };

/**
 * Čo chýba na odoslanie žiadosti. Vedome krátky zoznam: admin potrebuje vedieť,
 * **kto** o účet žiada, nič viac. IBAN ani storno podmienky sem nepatria — tie
 * treba až pred prvým predajom, pozri `chybaPredPredajom`.
 */
export function chybaNaZiadost(p: ProfilNaKontrolu): Nedostatok[] {
  const chyby: Nedostatok[] = [];
  const prazdne = (v?: string | null) => !v || !v.trim();

  if (prazdne(p.display_name)) chyby.push({ pole: "display_name", popis: "Verejný názov" });
  if (prazdne(p.subdomain)) chyby.push({ pole: "subdomain", popis: "Adresa profilu" });
  if (prazdne(p.company_name)) chyby.push({ pole: "company_name", popis: "Obchodné meno" });
  if (prazdne(p.ico)) chyby.push({ pole: "ico", popis: "IČO" });
  if (prazdne(p.billing_address))
    chyby.push({ pole: "billing_address", popis: "Fakturačná adresa" });
  if (prazdne(p.phone)) chyby.push({ pole: "phone", popis: "Telefón" });
  if (!p.terms_accepted_at) chyby.push({ pole: "terms", popis: "Súhlas s podmienkami" });

  return chyby;
}

/**
 * Čo chýba na spustenie predaja. Toto predaj neblokuje technicky, ale
 * organizátor to musí vidieť: bez IBAN-u nemá kam dostať tržbu a bez storno
 * podmienok predáva na diaľku bez povinnej informácie pre kupujúceho.
 */
export function chybaPredPredajom(p: ProfilNaKontrolu): Nedostatok[] {
  const chyby: Nedostatok[] = [];
  if (!p.payout_iban?.trim()) chyby.push({ pole: "payout_iban", popis: "IBAN na výplatu tržby" });
  if (!p.cancellation_policy?.trim())
    chyby.push({ pole: "cancellation_policy", popis: "Storno podmienky" });
  if (!p.complaint_contact?.trim())
    chyby.push({ pole: "complaint_contact", popis: "Kontakt na reklamácie" });
  if (!p.logo_url?.trim()) chyby.push({ pole: "logo_url", popis: "Logo" });
  return chyby;
}

/** Kroky sprievodcu. `99` v `onboarding_step` znamená dokončený. */
export const KROKY = [
  { cislo: 1, nazov: "Kto si", popis: "Verejný názov, logo, popis" },
  { cislo: 2, nazov: "Adresa", popis: "Vlastná adresa profilu" },
  { cislo: 3, nazov: "Sociálne siete", popis: "Odkazy na profily" },
  { cislo: 4, nazov: "Firma", popis: "Fakturačné údaje" },
  { cislo: 5, nazov: "Výplaty", popis: "IBAN a periodicita" },
  { cislo: 6, nazov: "Podmienky", popis: "Storno, reklamácie, súhlas" },
] as const;

export const KROK_HOTOVO = 99;
