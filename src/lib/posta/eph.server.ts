// Volanie ePodacieho hárku Slovenskej pošty.
//
// Služba: https://mojezasielky.posta.sk/integration/webServices/api
// WSDL:    tá istá adresa s `?wsdl`
//
// PREČO SOAP a nie REST: ich REST rozhranie (/integration/rest/v1) odpovedá
// na tomto účte HTTP 401 s HTML stránkou „Požiadavka bola zamietnutá" — a to
// rovnako s kľúčom aj bez neho, takže ho účet jednoducho nemá otvorené.
// SOAP rozhranie je to, ktoré má zapnuté.
//
// Prihlásenie nie je v hlavičke, ale v tele každej požiadavky (`auth`
// s userId a apiKey). Adresa služby je nastaviteľná kvôli testovaciemu
// prostrediu pošty.
import { hodnota, polozka, pripravPristupy } from "@/lib/pristupy.server";
import type { PolozkaKonfiguracie } from "@/lib/payment-gateways/types";
import {
  DRUHY_ZASIELKY,
  SPOSOBY_UHRADY,
  VERZIA,
  chybyHarku,
  ephXml,
  fault,
  hodnotaPrvku,
  obalka,
  xmlText,
  type AdresaEph,
  type ChybaHarku,
  type ZasielkaEph,
} from "./eph-soap";

export const PROVIDER = "posta";
const PREDVOLENA_ADRESA = "https://mojezasielky.posta.sk/integration/webServices/api";
const CAS_LIMIT_MS = 30_000;

type Pristupy = { userId: string; apiKey: string; adresa: string };

function pristupy(): Pristupy | null {
  const userId = hodnota(PROVIDER, "EPH_USER_ID");
  const apiKey = hodnota(PROVIDER, "EPH_API_KEY");
  if (!userId || !apiKey) return null;
  return { userId, apiKey, adresa: hodnota(PROVIDER, "EPH_BASE_URL") || PREDVOLENA_ADRESA };
}

export function jeEphNastavene(): boolean {
  return pristupy() !== null;
}

/** Odosielateľ — do hárku ide presne takto. */
/**
 * Pevná cena poštovného pre zákazníka, alebo `null`, keď nie je nastavená.
 *
 * Jedna hodnota namiesto prepínača a ceny zvlášť: doručenie poštou sa ponúka
 * práve vtedy, keď je cena určená. Nedá sa tak vyrobiť stav „zapnuté, ale
 * bez ceny", kde by poštovné platil organizátor bez toho, aby to chcel.
 */
export function postovne(): number | null {
  const suma = Number((hodnota(PROVIDER, "EPH_POSTOVNE") || "").replace(",", "."));
  return Number.isFinite(suma) && suma > 0 ? Math.round(suma * 100) / 100 : null;
}

/**
 * To isté ako `postovne()`, ale sama si načíta prístupy. Pokladňa sa o cenu
 * pýta skôr, než sa v požiadavke dotkne čohokoľvek iného od pošty.
 */
export async function cenaPostovneho(): Promise<number | null> {
  await pripravPristupy();
  return postovne();
}

export function odosielatel(): (AdresaEph & { odosielatelId: string }) | null {
  const ulica = hodnota(PROVIDER, "EPH_ODOSIELATEL_ULICA");
  const mesto = hodnota(PROVIDER, "EPH_ODOSIELATEL_MESTO");
  if (!ulica || !mesto) return null;
  return {
    // Technické parametre, príloha 2: „identifikácia podávateľa — používatelia
    // tento element nevypĺňajú". Posiela sa len tomu, kto ho má prideleny.
    odosielatelId: hodnota(PROVIDER, "EPH_ODOSIELATEL_ID") ?? "",
    organizacia: hodnota(PROVIDER, "EPH_ODOSIELATEL_FIRMA") || null,
    meno: hodnota(PROVIDER, "EPH_ODOSIELATEL_MENO") || null,
    ulica,
    mesto,
    psc: hodnota(PROVIDER, "EPH_ODOSIELATEL_PSC") || "",
    krajina: "SK",
    telefon: hodnota(PROVIDER, "EPH_ODOSIELATEL_TELEFON") || null,
    email: hodnota(PROVIDER, "EPH_ODOSIELATEL_EMAIL") || null,
  };
}

export function ephStav(): { pripravene: boolean; detail: string } {
  const p = pristupy();
  if (!p) {
    return {
      pripravene: false,
      detail: "Bez prístupov. Zapni WebEPH API v mojezasielky.posta.sk a vlož userId a kľúč.",
    };
  }
  if (!odosielatel()) {
    return {
      pripravene: false,
      detail: "Prístupy sú, ale chýba adresa odosielateľa alebo jeho ID.",
    };
  }
  const druh = Number(hodnota(PROVIDER, "EPH_DRUH_ZASIELKY"));
  if (!druh || !DRUHY_ZASIELKY[druh]) {
    return {
      pripravene: false,
      detail: `Chýba alebo nesedí druh zásielky. Možnosti: ${Object.entries(DRUHY_ZASIELKY)
        .map(([k, v]) => `${k} = ${v}`)
        .join(", ")}.`,
    };
  }
  const test = p.adresa !== PREDVOLENA_ADRESA;
  return {
    pripravene: true,
    detail: test ? `Nastavené, volá sa ${p.adresa}.` : "Nastavené, volá sa ostrá služba pošty.",
  };
}

export function ephKonfiguracia(): PolozkaKonfiguracie[] {
  const pol = (
    premenna: string,
    nazov: string,
    popis: string,
    opts?: { povinna?: boolean; tajna?: boolean },
  ) =>
    polozka(PROVIDER, {
      premenna,
      nazov,
      popis,
      povinna: opts?.povinna ?? false,
      tajna: opts?.tajna ?? false,
    });

  return [
    pol("EPH_USER_ID", "userId", "Z nastavenia WebEPH API vo webe pošty.", { povinna: true }),
    pol("EPH_API_KEY", "apiKey", "Druhá časť prístupu. Posiela sa v tele požiadavky.", {
      povinna: true,
      tajna: true,
    }),
    pol("EPH_BASE_URL", "Adresa služby", `Prázdne = ostrá ${PREDVOLENA_ADRESA}.`),
    pol("EPH_VERZIA", "Verzia formátu", `Prázdne = ${VERZIA}, ako uvádzajú technické parametre.`),
    pol(
      "EPH_DRUH_ZASIELKY",
      "Druh zásielky (číslo)",
      Object.entries(DRUHY_ZASIELKY)
        .map(([k, v]) => `${k} = ${v}`)
        .join(" · "),
      { povinna: true },
    ),
    pol(
      "EPH_SPOSOB_UHRADY",
      "Spôsob úhrady (číslo)",
      `Nepovinné. ${Object.entries(SPOSOBY_UHRADY)
        .map(([k, v]) => `${k} = ${v}`)
        .join(" · ")}`,
    ),
    pol("EPH_TYP", "Typ EPH (číslo)", "Nepovinné. 1 = podací hárok, 2 = potvrdenie o prijatí."),
    pol(
      "EPH_POSTOVNE",
      "Poštovné pre zákazníka (€)",
      "Pevná suma, ktorú zákazník zaplatí za doručenie obálky. " +
        "Prázdne alebo 0 = doručenie poštou sa v pokladni vôbec neponúkne.",
    ),
    pol(
      "EPH_ODOSIELATEL_ID",
      "ID podávateľa",
      "Nepovinné — vypĺňa sa, len ak ho pošta pridelila. Štandardne zostáva prázdne.",
    ),
    pol("EPH_ODOSIELATEL_FIRMA", "Odosielateľ — firma", "Názov, ktorý bude na štítku.", {
      povinna: true,
    }),
    pol("EPH_ODOSIELATEL_MENO", "Odosielateľ — meno", "Nepovinné, ak je vyplnená firma."),
    pol("EPH_ODOSIELATEL_ULICA", "Odosielateľ — ulica a číslo", "", { povinna: true }),
    pol("EPH_ODOSIELATEL_MESTO", "Odosielateľ — obec", "", { povinna: true }),
    pol("EPH_ODOSIELATEL_PSC", "Odosielateľ — PSČ", "", { povinna: true }),
    pol("EPH_ODOSIELATEL_TELEFON", "Odosielateľ — telefón", "Pošta ho použije pri probléme."),
    pol("EPH_ODOSIELATEL_EMAIL", "Odosielateľ — e-mail", ""),
  ];
}

export class ChybaPosty extends Error {
  constructor(
    message: string,
    readonly chyby: string[] = [],
    readonly stav?: number,
  ) {
    super(message);
    this.name = "ChybaPosty";
  }
}

async function volaj(operacia: string, telo: string): Promise<string> {
  const p = pristupy();
  if (!p) throw new ChybaPosty("ePodací hárok nemá vyplnené prístupy.");

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), CAS_LIMIT_MS);
  try {
    const r = await fetch(p.adresa, {
      method: "POST",
      headers: {
        "content-type": "text/xml; charset=utf-8",
        // Binding je document/literal; SOAPAction je názov operácie a musí
        // tam byť — bez nej príde fault `invalid_action`.
        SOAPAction: `"${operacia}"`,
        accept: "text/xml",
      },
      body: obalka(operacia, telo, { userId: p.userId, apiKey: p.apiKey }),
      signal: controller.signal,
    });
    const text = await r.text();

    const chyba = fault(text);
    if (chyba) throw new ChybaPosty(`Pošta odmietla požiadavku: ${chyba}`, [], r.status);
    if (!r.ok) {
      const html = text.trimStart().startsWith("<!DOCTYPE") || text.includes("<html");
      throw new ChybaPosty(
        html
          ? `Pošta odpovedala ${r.status} webovou stránkou, nie službou — over adresu a či je API na účte zapnuté.`
          : `Pošta odpovedala ${r.status}.`,
        [],
        r.status,
      );
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

export type StavHarku = { stav: string; chyby: ChybaHarku[] };

/** Stav hárku. Nič nevytvára, takže sa hodí aj na overenie spojenia. */
export async function stavHarku(sheetId: string): Promise<StavHarku> {
  const xml = await volaj("getSheetStatus", `<api:sheetId>${xmlText(sheetId)}</api:sheetId>`);
  return { stav: hodnotaPrvku(xml, "sheetStatus") ?? "", chyby: chybyHarku(xml) };
}

export async function harok(sheetId: string): Promise<{ stav: string; xml: string }> {
  const xml = await volaj("getSheet", `<api:sheetId>${xmlText(sheetId)}</api:sheetId>`);
  return { stav: hodnotaPrvku(xml, "sheetStatus") ?? "", xml };
}

/**
 * Pošle hárok so zásielkami. Vracia `sheetId`, pod ktorým ho pošta vedie.
 *
 * `preskocitChybne` zodpovedá ich `skipInvalid`: keď je zapnuté, pošta
 * prijme hárok aj s chybnými zásielkami a tie vynechá. Predvolene vypnuté —
 * ticho vynechaná zásielka znamená nedoručenú vstupenku.
 */
export async function importujHarok(
  zasielky: ZasielkaEph[],
  opts?: { zmluva?: boolean; preskocitChybne?: boolean; datum?: string },
): Promise<{ sheetId: string }> {
  const od = odosielatel();
  if (!od) throw new ChybaPosty("Nie je vyplnená adresa odosielateľa.");
  if (!zasielky.length) throw new ChybaPosty("Hárok musí obsahovať aspoň jednu zásielku.");

  const druh = Number(hodnota(PROVIDER, "EPH_DRUH_ZASIELKY"));
  const verzia = hodnota(PROVIDER, "EPH_VERZIA") || VERZIA;
  if (!druh) throw new ChybaPosty("Chýba druh zásielky — číslo z číselníka pošty.");

  const uhrada = Number(hodnota(PROVIDER, "EPH_SPOSOB_UHRADY")) || null;
  const typ = Number(hodnota(PROVIDER, "EPH_TYP")) || null;

  const xml = ephXml({
    verzia,
    mena: "EUR",
    typEph: typ,
    // Pošta chce RRRRMMDD; prevod je v `datumPosty`.
    datum: opts?.datum,
    druhZasielky: druh,
    sposobUhrady: uhrada,
    odosielatel: od,
    zasielky,
  });

  const odpoved = await volaj(
    "importSheet",
    [
      opts?.zmluva === undefined ? "" : `<api:contract>${opts.zmluva}</api:contract>`,
      `<api:skipInvalid>${opts?.preskocitChybne ?? false}</api:skipInvalid>`,
      xml,
    ].join(""),
  );

  const chyby = chybyHarku(odpoved);
  if (chyby.length) {
    throw new ChybaPosty(
      `Pošta hárok neprijala: ${chyby[0].pole} — ${chyby[0].dovod}`,
      chyby.map((c) => `${c.pole}: ${c.dovod}`),
    );
  }
  const sheetId = hodnotaPrvku(odpoved, "sheetId");
  if (!sheetId) throw new ChybaPosty("Pošta nevrátila identifikátor hárku.");
  return { sheetId };
}
