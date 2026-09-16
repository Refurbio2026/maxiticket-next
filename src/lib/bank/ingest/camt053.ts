// camt.053 — bankový výpis v XML.
//
// Používa ho ČSOB, Tatra banka aj SLSP. Je to ISO 20022 štandard, takže jeden
// parser stačí na všetky tri; líšia sa len tým, ktoré nepovinné polia vypĺňajú.
//
// Pozor na dve veci, ktoré starý systém robil zle:
//
// 1. **Znamienko nie je v sume.** `<Amt>` je vždy kladné a smer hovorí
//    `<CdtDbtInd>` (CRDT = pripísané, DBIT = odpísané). Kto to prehliadne,
//    zaúčtuje odchádzajúce platby ako tržbu.
// 2. **Protiúčet závisí od smeru.** Pri prijatej platbe je protistranou
//    dlžník (`DbtrAcct`), pri odoslanej veriteľ (`CdtrAcct`). Starý systém
//    bral vždy dlžníka, takže pri výplatách ukazoval vlastný účet.
import { XMLParser } from "fast-xml-parser";
import { normalizujSumu, normalizujIban, rozlozReferenciu, maskujKartu } from "../normalize";
import type { NormalizovanaTransakcia } from "../normalize";
import type { ParserVypisu, SuhrnVypisu, VysledokParsovania } from "./types";

/**
 * Parser s vypnutými entitami.
 *
 * Nahratý súbor je cudzí vstup: bez tohto by sa dala externou entitou prečítať
 * ľubovoľná cesta na serveri alebo vyvolať požiadavka do vnútornej siete (XXE).
 */
function novyParser(): XMLParser {
  return new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    processEntities: false,
    htmlEntities: false,
  });
}

type Uzol = Record<string, unknown>;

/** Vždy pole, aj keď XML malo jediný prvok. */
function pole(x: unknown): Uzol[] {
  if (x == null) return [];
  return (Array.isArray(x) ? x : [x]) as Uzol[];
}

/** Hodnota vnoreného uzla podľa cesty; `undefined`, keď ktorýkoľvek chýba. */
function cesta(uzol: unknown, ...kroky: string[]): unknown {
  let cur: unknown = uzol;
  for (const k of kroky) {
    if (cur == null || typeof cur !== "object") return undefined;
    cur = (cur as Uzol)[k];
    if (Array.isArray(cur)) cur = cur[0];
  }
  return cur;
}

function text(uzol: unknown, ...kroky: string[]): string | null {
  const v = cesta(uzol, ...kroky);
  if (v == null) return null;
  if (typeof v === "object") {
    const t = (v as Uzol)["#text"];
    return t == null ? null : String(t);
  }
  return String(v);
}

/** Zostatok daného typu (OPBD = počiatočný, CLBD = koncový). */
function zostatok(bal: Uzol[], kod: string): number | null {
  for (const b of bal) {
    if (text(b, "Tp", "CdOrPrtry", "Cd") !== kod) continue;
    const suma = normalizujSumu(text(b, "Amt"));
    if (suma == null) return null;
    // Aj zostatok má smer: debetný sa zapisuje kladne so značkou DBIT.
    return text(b, "CdtDbtInd") === "DBIT" ? -suma : suma;
  }
  return null;
}

function referencia(ntry: Uzol): { vs: string | null; ss: string | null; ks: string | null } {
  const detaily = cesta(ntry, "NtryDtls", "TxDtls");
  const e2e = text(detaily, "Refs", "EndToEndId");
  const zE2e = rozlozReferenciu(e2e);
  if (zE2e.vs) return zE2e;

  // Keď referencia neprišla, skúsi sa správa pre príjemcu — ČSOB a VÚB
  // symboly do vlastných polí často nedávajú.
  const ustrd = pole(cesta(detaily, "RmtInf"))
    .map((r) => text(r, "Ustrd"))
    .filter(Boolean)
    .join(" ");
  return rozlozReferenciu(ustrd || e2e);
}

function popis(ntry: Uzol): string | null {
  const detaily = cesta(ntry, "NtryDtls", "TxDtls");
  const casti = [
    text(ntry, "AddtlNtryInf"),
    text(detaily, "RmtInf", "Ustrd"),
    text(detaily, "RltdPties", "Dbtr", "Nm"),
  ].filter((x): x is string => !!x && x.trim().length > 0);
  const spojene = [...new Set(casti)].join(" · ").slice(0, 250);
  return maskujKartu(spojene) || null;
}

function protiucet(ntry: Uzol, prijate: boolean): { iban: string | null; nazov: string | null } {
  const strany = cesta(ntry, "NtryDtls", "TxDtls", "RltdPties");
  // Pri prijatej platbe je protistranou dlžník, pri odoslanej veriteľ.
  const kluc = prijate ? "Dbtr" : "Cdtr";
  const uctKluc = prijate ? "DbtrAcct" : "CdtrAcct";
  return {
    iban: normalizujIban(text(strany, uctKluc, "Id", "IBAN")),
    nazov: text(strany, kluc, "Nm"),
  };
}

export function parsujCamt053(obsah: string): VysledokParsovania {
  const vysledok: VysledokParsovania = { suhrn: null, transakcie: [], chyby: [] };

  let root: Uzol;
  try {
    root = novyParser().parse(obsah) as Uzol;
  } catch (e) {
    vysledok.chyby.push({ chyba: `Súbor sa nedá prečítať ako XML: ${(e as Error).message}` });
    return vysledok;
  }

  const stmt = pole(cesta(root, "Document", "BkToCstmrStmt", "Stmt"));
  if (stmt.length === 0) {
    vysledok.chyby.push({
      chyba: "V súbore nie je výpis camt.053 (chýba Document/BkToCstmrStmt/Stmt).",
    });
    return vysledok;
  }

  const prvy = stmt[0];
  const mena =
    text(prvy, "Acct", "Ccy") ??
    (cesta(prvy, "Bal", "Amt") as Uzol | undefined)?.["@Ccy"]?.toString() ??
    "EUR";

  for (const s of stmt) {
    for (const ntry of pole(s.Ntry)) {
      try {
        const hrubaSuma = normalizujSumu(text(ntry, "Amt"));
        if (hrubaSuma == null) {
          vysledok.chyby.push({ chyba: "Pohyb bez použiteľnej sumy — preskočený." });
          continue;
        }
        const prijate = text(ntry, "CdtDbtInd") !== "DBIT";
        const suma = prijate ? Math.abs(hrubaSuma) : -Math.abs(hrubaSuma);

        const datum =
          text(ntry, "BookgDt", "Dt") ?? text(ntry, "BookgDt", "DtTm") ?? text(ntry, "ValDt", "Dt");
        if (!datum) {
          vysledok.chyby.push({ chyba: "Pohyb bez dátumu zaúčtovania — preskočený." });
          continue;
        }

        const { vs, ss, ks } = referencia(ntry);
        const strana = protiucet(ntry, prijate);
        const ntryRef = text(ntry, "NtryRef") ?? text(ntry, "AcctSvcrRef");
        const menaPohybu =
          ((cesta(ntry, "Amt") as Uzol | undefined)?.["@Ccy"] as string | undefined) ?? mena;

        const tx: NormalizovanaTransakcia = {
          // Referencia banky je stabilná medzi opakovanými importmi — presne
          // to, čo potrebuje unikátny kľúč proti dvojitému nahratiu výpisu.
          external_id: ntryRef ? `camt:${ntryRef}` : null,
          booked_at: new Date(`${datum.slice(0, 10)}T00:00:00Z`).toISOString(),
          value_date: text(ntry, "ValDt", "Dt")?.slice(0, 10) ?? null,
          amount: suma,
          currency: String(menaPohybu).toUpperCase(),
          vs_normalized: vs,
          variable_symbol: vs,
          specific_symbol: ss,
          constant_symbol: ks,
          counterparty_iban: strana.iban,
          counterparty_name: strana.nazov,
          message: popis(ntry),
          provider_tx_id: null,
        };
        vysledok.transakcie.push(tx);
      } catch (e) {
        // Chybný pohyb nesmie zhodiť celý výpis — starý systém pri prvom
        // probléme ukončil spracovanie a zvyšok mesiaca sa nenaimportoval.
        vysledok.chyby.push({ chyba: `Pohyb sa nepodarilo prečítať: ${(e as Error).message}` });
      }
    }
  }

  const bal = pole(prvy.Bal);
  const od = text(prvy, "FrToDt", "FrDtTm")?.slice(0, 10) ?? null;
  const doDatumu = text(prvy, "FrToDt", "ToDtTm")?.slice(0, 10) ?? null;
  const datumy = vysledok.transakcie.map((t) => t.booked_at.slice(0, 10)).sort();

  const kredity = vysledok.transakcie.filter((t) => t.amount > 0);
  const debety = vysledok.transakcie.filter((t) => t.amount < 0);
  const suma = (xs: NormalizovanaTransakcia[]) =>
    Math.round(xs.reduce((s, t) => s + t.amount, 0) * 100) / 100;

  const suhrn: SuhrnVypisu = {
    period_from: od ?? datumy[0] ?? "",
    period_to: doDatumu ?? datumy[datumy.length - 1] ?? "",
    opening_balance: zostatok(bal, "OPBD") ?? zostatok(bal, "PRCD"),
    closing_balance: zostatok(bal, "CLBD"),
    credit_sum: suma(kredity),
    debit_sum: Math.abs(suma(debety)),
    charges_sum: 0,
    credit_count: kredity.length,
    debit_count: debety.length,
    currency: String(mena).toUpperCase(),
  };
  vysledok.suhrn = suhrn.period_from ? suhrn : null;

  return vysledok;
}

export const camt053: ParserVypisu = {
  id: "camt053",
  nazov: "camt.053 XML (ČSOB, Tatra banka, SLSP)",
  pripony: ["xml"],
  parsuj: parsujCamt053,
};
