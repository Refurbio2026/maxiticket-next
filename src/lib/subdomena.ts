// Subdomény organizátorov — tvar, rezervované názvy a čítanie z `Host`.
//
// Súbor je izomorfný (žiadny server-only import), aby tú istú kontrolu robil
// prehliadač pri písaní aj server pri ukladaní. Tretia kópia pravidla je
// v databáze (`profiles_subdomain_tvar` a `_rezervovane`), lebo subdoména je
// verejná adresa — keby sa dala uložiť dvakrát alebo v inom tvare, prestala by
// adresou byť.

/** Malé písmená, číslice a spojovník; 3–32 znakov; nezačína ani nekončí spojovníkom. */
export const TVAR_SUBDOMENY = /^[a-z0-9][a-z0-9-]{1,30}[a-z0-9]$/;

/**
 * Názvy, ktoré sú už adresou alebo by ňou mohli byť. Zoznam je zrkadlený
 * v migrácii `20261002120000_organizator_subdomena.sql`; tu sa dá rozšíriť bez
 * migrácie, tam je preto, aby sa to nedalo obísť zápisom do databázy.
 */
export const REZERVOVANE_SUBDOMENY = [
  "www",
  "api",
  "admin",
  "app",
  "mail",
  "smtp",
  "imap",
  "ftp",
  "ns1",
  "ns2",
  "static",
  "cdn",
  "assets",
  "img",
  "images",
  "files",
  "download",
  "scanner",
  "organizer",
  "checkout",
  "account",
  "login",
  "register",
  "support",
  "help",
  "status",
  "blog",
  "shop",
  "pay",
  "payments",
  "eticketo",
  "tticketo",
  "maxiticket",
  "vipky",
  "test",
  "dev",
  "staging",
  "local",
  "localhost",
];

/** Prečo sa subdoména nedá použiť, alebo `null`, keď je v poriadku. */
export function chybaSubdomeny(subdomena: string): string | null {
  const s = subdomena.trim().toLowerCase();
  if (!s) return "Zadaj subdoménu.";
  if (s.length < 3) return "Subdoména musí mať aspoň 3 znaky.";
  if (s.length > 32) return "Subdoména smie mať najviac 32 znakov.";
  if (!TVAR_SUBDOMENY.test(s)) {
    return "Dovolené sú malé písmená, číslice a spojovník; nesmie začínať ani končiť spojovníkom.";
  }
  if (REZERVOVANE_SUBDOMENY.includes(s)) return "Táto subdoména je rezervovaná.";
  return null;
}

/** Návrh subdomény z názvu organizátora — diakritika preč, medzery na spojovník. */
export function navrhSubdomeny(nazov: string): string {
  const bezDiakritiky = nazov.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
  const slug = bezDiakritiky
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 32)
    .replace(/-+$/g, "");
  if (slug.length < 3) return "";
  return REZERVOVANE_SUBDOMENY.includes(slug) ? `${slug}-eu`.slice(0, 32) : slug;
}

/** Z `https://eticketo.eu` spraví `eticketo.eu`. Bez protokolu, portu a `www.`. */
export function zakladnaDomena(adresa: string): string {
  const bezProtokolu = adresa.replace(/^https?:\/\//i, "");
  const bezCesty = bezProtokolu.split("/")[0];
  const bezPortu = bezCesty.split(":")[0];
  return bezPortu.replace(/^www\./i, "").toLowerCase();
}

/**
 * Subdoména z hlavičky `Host`, alebo `null`, keď ide o hlavnú adresu.
 *
 * `www` je hlavná adresa, nie organizátor. Viacúrovňové meno
 * (`a.b.eticketo.eu`) nepovažujeme za subdoménu organizátora — wildcard
 * certifikát ho aj tak nepokrýva.
 */
export function subdomenaZHosta(host: string | null | undefined, adresa: string): string | null {
  if (!host) return null;
  const h = host.split(":")[0].trim().toLowerCase();
  const domena = zakladnaDomena(adresa);
  if (!h || h === domena || h === `www.${domena}`) return null;
  if (!h.endsWith(`.${domena}`)) return null;
  const predok = h.slice(0, -(domena.length + 1));
  if (!predok || predok.includes(".")) return null;
  if (REZERVOVANE_SUBDOMENY.includes(predok)) return null;
  return TVAR_SUBDOMENY.test(predok) ? predok : null;
}
