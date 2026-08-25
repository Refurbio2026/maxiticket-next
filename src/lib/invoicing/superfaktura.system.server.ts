// SuperFaktúra pod spoločným rozhraním. REST klient zostáva
// v superfaktura.server.ts, tento súbor len prekladá jeho tvar.
import { hodnota, polozka } from "../pristupy.server";
import type { PolozkaKonfiguracie, TestBrany } from "../payment-gateways/types";
import { createPaidInvoice } from "../superfaktura.server";
import type { FakturacnySystem, FakturaVstup, FakturaVysledok } from "./types";

export const superFakturaSystem: FakturacnySystem = {
  id: "superfaktura",
  label: "SuperFaktúra",
  hint: "Faktúry cez API SuperFaktúry.",

  isConfigured(): boolean {
    return !!(
      hodnota("superfaktura", "SUPERFAKTURA_EMAIL") &&
      hodnota("superfaktura", "SUPERFAKTURA_API_KEY") &&
      hodnota("superfaktura", "SUPERFAKTURA_COMPANY_ID")
    );
  },

  async vystav(input: FakturaVstup): Promise<FakturaVysledok> {
    const r = await createPaidInvoice(input);
    return {
      invoice_id: r.invoice_id,
      invoice_number: r.invoice_number,
      pdf_url: r.pdf_url,
      raw: r.raw,
    };
  },

  async pdfAdresa(): Promise<string | null> {
    // Adresa zo SuperFaktúry obsahuje token a platí natrvalo — netreba ju
    // doťahovať znovu.
    return null;
  },

  konfiguracia(): PolozkaKonfiguracie[] {
    return [
      polozka("superfaktura", {
        premenna: "SUPERFAKTURA_EMAIL",
        nazov: "E-mail",
        popis: "Prihlasovací e-mail do SuperFaktúry",
        povinna: true,
      }),
      polozka("superfaktura", {
        premenna: "SUPERFAKTURA_API_KEY",
        nazov: "API kľúč",
        popis: "Z nastavení SuperFaktúry, sekcia API",
        povinna: true,
        tajna: true,
      }),
      polozka("superfaktura", {
        premenna: "SUPERFAKTURA_COMPANY_ID",
        nazov: "Id firmy",
        popis: "Číslo firmy, na ktorú sa fakturuje",
        povinna: true,
      }),
      polozka("superfaktura", {
        premenna: "SUPERFAKTURA_API_URL",
        nazov: "Adresa API",
        popis: "Bez vyplnenia sa použije https://moja.superfaktura.sk",
        povinna: false,
      }),
    ];
  },

  endpoint(): string {
    return (
      hodnota("superfaktura", "SUPERFAKTURA_API_URL") || "https://moja.superfaktura.sk"
    ).replace(/\/+$/, "");
  },

  rezim(): "test" | "ostrá" | "neznáma" {
    return (hodnota("superfaktura", "SUPERFAKTURA_SANDBOX") || "true").toLowerCase() === "true"
      ? "test"
      : "ostrá";
  },

  async test(): Promise<TestBrany> {
    // SuperFaktúra nemá endpoint na overenie prístupov bez zápisu, takže sa
    // dá skontrolovať len to, či sú vyplnené. Nech to nevyzerá ako záruka.
    return {
      ok: true,
      detail:
        "Prístupy sú vyplnené. Či ich SuperFaktúra prijme, ukáže až prvá vystavená faktúra — " +
        "overenie naprázdno nepozná.",
    };
  },
};
