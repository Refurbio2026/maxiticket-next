// Fio banka — CSV výpis aj REST API.
//
// Obe cesty vracajú tie isté údaje, len inak zabalené, preto sú v jednom
// súbore. Kľúčové je ID pohybu: Fio ho dáva v oboch formátoch a je stabilné,
// takže sa ten istý pohyb nenaimportuje dvakrát ani keď ho účtovník nahrá zo
// súboru a cron medzitým stiahne cez API.
import { normalizujSumu, normalizujIban, normalizujSymbol, maskujKartu } from "../normalize";
import type { NormalizovanaTransakcia } from "../normalize";
import { dopocitajSuhrn, type ApiZdroj, type ParserVypisu, type VysledokParsovania } from "./types";

/** Rozdelí CSV riadok s bodkočiarkou a úvodzovkami. */
function rozdel(riadok: string): string[] {
  const out: string[] = [];
  let aktualne = "";
  let vUvodzovkach = false;
  for (let i = 0; i < riadok.length; i++) {
    const z = riadok[i];
    if (z === '"') {
      if (vUvodzovkach && riadok[i + 1] === '"') {
        aktualne += '"';
        i++;
      } else {
        vUvodzovkach = !vUvodzovkach;
      }
    } else if (z === ";" && !vUvodzovkach) {
      out.push(aktualne.trim());
      aktualne = "";
    } else {
      aktualne += z;
    }
  }
  out.push(aktualne.trim());
  return out;
}

/** Dátum `dd.mm.yyyy` alebo `yyyy-mm-dd` na ISO. */
function naIso(hodnota: string | undefined): string | null {
  if (!hodnota) return null;
  const t = hodnota.trim();
  const sk = t.match(/^(\d{1,2})\.\s?(\d{1,2})\.\s?(\d{4})/);
  if (sk) {
    return `${sk[3]}-${sk[2].padStart(2, "0")}-${sk[1].padStart(2, "0")}`;
  }
  const iso = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (iso) return `${iso[1]}-${iso[2]}-${iso[3]}`;
  return null;
}

/** Hlavičky CSV sa medzi slovenskou a českou verziou líšia. */
const STLPCE: Record<string, string[]> = {
  id: ["id operace", "id operácie", "id pohybu"],
  datum: ["datum", "dátum"],
  objem: ["objem", "suma", "částka", "čiastka"],
  mena: ["měna", "mena"],
  protiucet: ["protiúčet", "protiucet"],
  nazovProtiuctu: ["název protiúčtu", "názov protiúčtu"],
  vs: ["vs", "variabilní symbol", "variabilný symbol"],
  ss: ["ss", "specifický symbol", "špecifický symbol"],
  ks: ["ks", "konstantní symbol", "konštantný symbol"],
  sprava: ["zpráva pro příjemce", "správa pre príjemcu", "poznámka", "komentář", "komentár"],
};

function indexy(hlavicka: string[]): Record<string, number> {
  const mapa: Record<string, number> = {};
  const znormalizovane = hlavicka.map((h) =>
    h
      .toLowerCase()
      .replace(/^\ufeff/, "")
      .trim(),
  );
  for (const [kluc, varianty] of Object.entries(STLPCE)) {
    const i = znormalizovane.findIndex((h) => varianty.includes(h));
    if (i >= 0) mapa[kluc] = i;
  }
  return mapa;
}

export function parsujFioCsv(obsah: string): VysledokParsovania {
  const vysledok: VysledokParsovania = { suhrn: null, transakcie: [], chyby: [] };
  const riadky = obsah.replace(/^\ufeff/, "").split(/\r?\n/);

  // Fio dáva pred tabuľkou hlavičku s účtom a zostatkami; tabuľka začína
  // riadkom, v ktorom je „ID operace"/„ID pohybu".
  const zaciatok = riadky.findIndex((r) => /id\s+(operace|operácie|pohybu)/i.test(r));
  if (zaciatok < 0) {
    vysledok.chyby.push({
      chyba: "V CSV sa nenašla hlavička tabuľky pohybov (stĺpec „ID operace“).",
    });
    return vysledok;
  }

  const mapa = indexy(rozdel(riadky[zaciatok]));
  for (const povinny of ["datum", "objem"]) {
    if (mapa[povinny] === undefined) {
      vysledok.chyby.push({ chyba: `V CSV chýba povinný stĺpec: ${povinny}.` });
      return vysledok;
    }
  }

  // Zostatky z hlavičky súboru — kvôli kontrole nadväznosti mesiacov.
  const zaciatocny = riadky
    .slice(0, zaciatok)
    .find((r) => /počáteční stav|počiatočný stav/i.test(r));
  const koncovy = riadky.slice(0, zaciatok).find((r) => /koncový stav|konečný stav/i.test(r));
  const zostatok = (riadok: string | undefined) =>
    riadok ? normalizujSumu(rozdel(riadok).slice(1).join(" ")) : null;

  for (let i = zaciatok + 1; i < riadky.length; i++) {
    const surovy = riadky[i];
    if (!surovy.trim()) continue;
    const bunky = rozdel(surovy);

    try {
      const datum = naIso(bunky[mapa.datum]);
      const suma = normalizujSumu(bunky[mapa.objem]);
      if (!datum || suma == null) {
        vysledok.chyby.push({
          chyba: "Riadok bez dátumu alebo sumy.",
          riadok: surovy.slice(0, 120),
        });
        continue;
      }

      const idPohybu = mapa.id !== undefined ? bunky[mapa.id]?.trim() : "";
      const vs = normalizujSymbol(mapa.vs !== undefined ? bunky[mapa.vs] : null);
      const protiucet = mapa.protiucet !== undefined ? bunky[mapa.protiucet] : null;

      vysledok.transakcie.push({
        external_id: idPohybu ? `fio:${idPohybu}` : null,
        booked_at: new Date(`${datum}T00:00:00Z`).toISOString(),
        value_date: datum,
        amount: suma,
        currency: (mapa.mena !== undefined ? bunky[mapa.mena] : "EUR")?.toUpperCase() || "EUR",
        vs_normalized: vs,
        variable_symbol: vs,
        specific_symbol: normalizujSymbol(mapa.ss !== undefined ? bunky[mapa.ss] : null),
        constant_symbol: normalizujSymbol(mapa.ks !== undefined ? bunky[mapa.ks] : null, 4),
        // Fio v CSV dáva číslo účtu, nie IBAN; keď to IBAN nie je, nechá sa tak.
        counterparty_iban: normalizujIban(protiucet),
        counterparty_name:
          mapa.nazovProtiuctu !== undefined ? bunky[mapa.nazovProtiuctu] || null : null,
        message: maskujKartu(mapa.sprava !== undefined ? bunky[mapa.sprava] : null),
        provider_tx_id: idPohybu || null,
      });
    } catch (e) {
      vysledok.chyby.push({
        chyba: `Riadok sa nepodarilo prečítať: ${(e as Error).message}`,
        riadok: surovy.slice(0, 120),
      });
    }
  }

  vysledok.suhrn = dopocitajSuhrn(vysledok.transakcie, {
    opening_balance: zostatok(zaciatocny),
    closing_balance: zostatok(koncovy),
  });
  return vysledok;
}

export const fioCsv: ParserVypisu = {
  id: "fio_csv",
  nazov: "Fio banka — CSV výpis",
  pripony: ["csv", "txt"],
  parsuj: parsujFioCsv,
};

// --- REST API -----------------------------------------------------------

/** Čísla stĺpcov v JSON odpovedi Fio. Sú stabilné a zdokumentované. */
const FIO = {
  datum: "column0",
  objem: "column1",
  protiucet: "column2",
  kodBanky: "column3",
  vs: "column5",
  ks: "column4",
  ss: "column6",
  nazovProtiuctu: "column10",
  sprava: "column16",
  idPohybu: "column22",
  komentar: "column25",
  mena: "column14",
} as const;

type FioHodnota = { value: unknown } | null | undefined;
type FioRiadok = Record<string, FioHodnota>;

function hodnota(riadok: FioRiadok, kluc: string): string | null {
  const bunka = riadok?.[kluc];
  if (!bunka || bunka.value == null) return null;
  return String(bunka.value);
}

export function prevedFioJson(json: unknown): VysledokParsovania {
  const vysledok: VysledokParsovania = { suhrn: null, transakcie: [], chyby: [] };
  const riadky = (json as { accountStatement?: { transactionList?: { transaction?: unknown[] } } })
    ?.accountStatement?.transactionList?.transaction;

  if (!Array.isArray(riadky)) {
    vysledok.chyby.push({ chyba: "Odpoveď Fio API nemá očakávaný tvar (transactionList)." });
    return vysledok;
  }

  for (const surovy of riadky) {
    try {
      const r = surovy as FioRiadok;
      const suma = normalizujSumu(hodnota(r, FIO.objem));
      // Fio posiela dátum ako `2026-03-03+0100` — pásmo netreba, deň áno.
      const datum = hodnota(r, FIO.datum)?.slice(0, 10) ?? null;
      if (suma == null || !datum) {
        vysledok.chyby.push({ chyba: "Pohyb z Fio API bez sumy alebo dátumu." });
        continue;
      }
      const id = hodnota(r, FIO.idPohybu);
      const vs = normalizujSymbol(hodnota(r, FIO.vs));
      const sprava = [hodnota(r, FIO.sprava), hodnota(r, FIO.komentar)].filter(Boolean).join(" · ");

      vysledok.transakcie.push({
        external_id: id ? `fio:${id}` : null,
        booked_at: new Date(`${datum}T00:00:00Z`).toISOString(),
        value_date: datum,
        amount: suma,
        currency: (hodnota(r, FIO.mena) || "EUR").toUpperCase(),
        vs_normalized: vs,
        variable_symbol: vs,
        specific_symbol: normalizujSymbol(hodnota(r, FIO.ss)),
        constant_symbol: normalizujSymbol(hodnota(r, FIO.ks), 4),
        counterparty_iban: normalizujIban(hodnota(r, FIO.protiucet)),
        counterparty_name: hodnota(r, FIO.nazovProtiuctu),
        message: maskujKartu(sprava) || null,
        provider_tx_id: id,
      });
    } catch (e) {
      vysledok.chyby.push({
        chyba: `Pohyb z Fio API sa nepodarilo prečítať: ${(e as Error).message}`,
      });
    }
  }

  vysledok.suhrn = dopocitajSuhrn(vysledok.transakcie);
  return vysledok;
}

function den(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export const fioApi: ApiZdroj = {
  id: "fio_api",
  async stiahni({ tajomstvo, od, do: doDatumu }) {
    const url =
      `https://fioapi.fio.cz/v1/rest/periods/${encodeURIComponent(tajomstvo)}/` +
      `${den(od)}/${den(doDatumu)}/transactions.json`;

    // Bez časového limitu by zaseknutá odpoveď zablokovala celý beh cronu —
    // a ten rieši peniaze, takže nesmie visieť na jednom zdroji.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        // Token je v URL (tak to Fio API vyžaduje), preto sa adresa nesmie
        // dostať do chybovej hlášky ani do logu.
        throw new Error(`Fio API odpovedalo ${res.status}`);
      }
      return prevedFioJson(await res.json());
    } finally {
      clearTimeout(timer);
    }
  },
};
