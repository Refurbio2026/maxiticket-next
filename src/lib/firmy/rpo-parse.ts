// Čítanie odpovede RPO (Register právnických osôb, Štatistický úrad SR).
//
// Čisté — žiadna sieť. Je to tu zvlášť preto, že odpoveď nie je plochá:
// názvy, adresy aj zápisy v registri sú **polia s platnosťou od–do**, pretože
// register drží históriu. Keby sa vzal prvý prvok, firma po presťahovaní by
// dostala starú adresu — MaxiTicket má v registri tri adresy, z toho dve
// neplatné (Trnava, Kučišdorfská dolina).
import { normalizujIco, type Firma } from "./firmy";

type Platnost = { validFrom?: string; validTo?: string };

/**
 * Vyberie aktuálne platný záznam.
 *
 * Platný je ten, ktorý nemá `validTo`. Keby ich bolo viac, vezme sa ten
 * s najnovším `validFrom`. Keď nemá `validTo` ani jeden, berie sa najnovší —
 * lepšie novší údaj než žiadny.
 */
export function aktualny<T extends Platnost>(zoznam: unknown): T | null {
  if (!Array.isArray(zoznam) || zoznam.length === 0) return null;
  const polozky = zoznam as T[];
  const otvorene = polozky.filter((p) => !p.validTo);
  const kandidati = otvorene.length > 0 ? otvorene : polozky;
  return [...kandidati].sort((a, b) => (b.validFrom ?? "").localeCompare(a.validFrom ?? ""))[0];
}

/** `Sro/170046/B` → `oddiel Sro, vložka č. 170046/B`, nech sa to dá čítať. */
export function zapisVRegistri(sud: string | null, cislo: string | null): string | null {
  if (!sud && !cislo) return null;
  const m = cislo?.match(/^([A-Za-z]+)\/(.+)$/);
  const casti = [
    sud ? `Obchodný register ${sud}` : null,
    m ? `oddiel ${m[1]}, vložka č. ${m[2]}` : cislo,
  ].filter(Boolean);
  return casti.join(", ");
}

/** Jeden výsledok z RPO → naša firma. `null`, keď v ňom nie je ani IČO a názov. */
export function precitajVysledok(vysledok: unknown): Firma | null {
  const v = (vysledok ?? {}) as Record<string, unknown>;

  const ico = normalizujIco(aktualny<{ value?: string } & Platnost>(v.identifiers)?.value ?? "");
  const nazov = (aktualny<{ value?: string } & Platnost>(v.fullNames)?.value ?? "").trim();
  if (!ico && !nazov) return null;

  const adresa = aktualny<
    {
      street?: string;
      buildingNumber?: string;
      postalCodes?: string[];
      municipality?: { value?: string };
      country?: { value?: string };
    } & Platnost
  >(v.addresses);

  const ulica = [adresa?.street, adresa?.buildingNumber].filter(Boolean).join(" ").trim() || null;

  const zdrojRegistra = (v.sourceRegister ?? {}) as Record<string, unknown>;
  const sud = aktualny<{ value?: string } & Platnost>(zdrojRegistra.registrationOffices)?.value;
  const cislo = aktualny<{ value?: string } & Platnost>(zdrojRegistra.registrationNumbers)?.value;

  return {
    nazov,
    ico,
    // RPO DIČ ani IČ DPH nevracia — na to treba FinStat alebo ich zadá zákazník.
    dic: null,
    ic_dph: null,
    ulica,
    mesto: adresa?.municipality?.value?.trim() || null,
    psc: adresa?.postalCodes?.[0]?.trim() || null,
    stat: adresa?.country?.value?.toLowerCase().includes("slovensk") ? "SK" : "SK",
    zdroj: "rpo",
    registracia: zapisVRegistri(sud ?? null, cislo ?? null),
  };
}

/** Celá odpoveď RPO → zoznam firiem. Čo sa nedá prečítať, sa vynechá. */
export function precitajOdpoved(data: unknown): Firma[] {
  const d = (data ?? {}) as Record<string, unknown>;
  const vysledky = Array.isArray(d.results) ? d.results : [];
  return vysledky
    .map((v) => precitajVysledok(v))
    .filter((f): f is Firma => f !== null && (f.ico !== "" || f.nazov !== ""));
}
