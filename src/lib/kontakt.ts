// Identifikácia prevádzkovateľa a kontaktné údaje — jediný zdroj pravdy.
//
// Dovtedy boli tieto údaje napísané priamo v kontaktnej stránke a boli
// vymyslené (iná firma, iné mesto, neexistujúci telefón). Keďže to isté
// musí sedieť na kontakte, v pätičke, na faktúre aj v e-mailoch, stojí to
// na jednom mieste a mení sa len tu.
//
// Údaje sú overené 19. 10. 2026 proti dvom registrom:
//   RPO  (api.statistics.sk/rpo/v1/search?identifier=53251580)
//   ORSR (orsr.sk, Mestský súd Bratislava III, ID 663307)
// Sídlo sedí s obchodnými podmienkami; súd a vložka v podmienkach NESEDIA
// s registrom — pozri poznámku pri `registracia`.

export const PREVADZKOVATEL = {
  nazov: "MaxiTicket s.r.o.",
  ulica: "Drevárska 23",
  psc: "902 01",
  mesto: "Pezinok",
  stat: "Slovenská republika",
  ico: "53 251 580",

  /**
   * Zápis v obchodnom registri podľa výpisu z 19. 10. 2026.
   *
   * Pozor: publikované obchodné podmienky uvádzajú „Okresný súd Bratislava I,
   * vložka č. 14844" resp. „148442/B". Register uvádza Mestský súd
   * Bratislava III a vložku 170046/B (okresné súdy pre obchodný register
   * zanikli 1. 6. 2023). Platí register; podmienky treba opraviť.
   */
  registracia: "Obchodný register Mestského súdu Bratislava III, oddiel Sro, vložka č. 170046/B",

  /** Adresa, na ktorú chodia dopyty zákazníkov. Rovnaká je v právnych stránkach. */
  email: "podpora@eticketo.eu",

  /**
   * Telefón sa zámerne nezverejňuje: číslo, ktoré tu bolo predtým
   * (+421 2 22 333 444), neexistuje. Doplniť až so skutočným číslom.
   */
  telefon: null as string | null,

  web: "eticketo.eu",

  /** Sídlo podľa geokódovania OSM (ulica Drevárska, Pezinok). */
  poloha: { lat: 48.28002, lon: 17.26224 },
} as const;

/** Jednoriadková identifikácia do pätičky a dokumentov. */
export function identifikaciaJedenRiadok(): string {
  const p = PREVADZKOVATEL;
  return `${p.nazov}, ${p.ulica}, ${p.psc} ${p.mesto}, IČO ${p.ico}`;
}

/** Embed mapy so sídlom — bez cudzích skriptov, len iframe na OSM. */
export function mapaUrl(): string {
  const { lat, lon } = PREVADZKOVATEL.poloha;
  const d = 0.008;
  const bbox = [lon - d, lat - d / 2, lon + d, lat + d / 2].map((n) => n.toFixed(4)).join("%2C");
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${lat}%2C${lon}`;
}
