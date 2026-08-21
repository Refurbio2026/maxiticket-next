// Šifrovanie tajomstiev, ktoré sa ukladajú do databázy.
//
// Prístupy k platobným bránam sa dajú zadať v administrácii, takže končia
// v tabuľke. Samotný odpis databázy ale nesmie stačiť na to, aby sa dalo
// platiť cudzím účtom — preto sú hodnoty šifrované kľúčom, ktorý v databáze
// nie je a zostáva v secrets na serveri.
//
// AES-256-GCM: okrem utajenia dáva aj kontrolu neporušenosti. Kto by v tabuľke
// hodnotu prepísal, dešifrovanie zlyhá a nedostane potichu iný kľúč.
import crypto from "node:crypto";

const PREFIX = "v1";
// Pevná soľ je v poriadku: kľúč je odvodený z náhodného serverového tajomstva,
// nie z hesla, takže soľ tu nechráni pred slovníkovým útokom.
const SOL = Buffer.from("maxiticket-secrets-v1");

let kluc: Buffer | null = null;

function odvodenyKluc(): Buffer {
  if (kluc) return kluc;
  const zaklad =
    process.env.SECRETS_ENCRYPTION_KEY ||
    process.env.TICKET_QR_SECRET ||
    process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!zaklad) {
    throw new Error(
      "Chýba SECRETS_ENCRYPTION_KEY (alebo TICKET_QR_SECRET / SUPABASE_SERVICE_ROLE_KEY) — " +
        "bez neho sa prístupy k platobným bránam nedajú bezpečne uložiť.",
    );
  }
  kluc = crypto.scryptSync(zaklad, SOL, 32);
  return kluc;
}

/** Len pre testy — kľúč sa inak odvodí raz za život procesu. */
export function zabudniKluc(): void {
  kluc = null;
}

export function zasifruj(text: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv("aes-256-gcm", odvodenyKluc(), iv);
  const sifra = Buffer.concat([c.update(text, "utf8"), c.final()]);
  return [
    PREFIX,
    iv.toString("base64"),
    c.getAuthTag().toString("base64"),
    sifra.toString("base64"),
  ].join(":");
}

/**
 * Vráti `null`, keď sa hodnota dešifrovať nedá — pokazený zápis, iný kľúč
 * alebo pokus o podvrh. Volajúci to musí brať ako „hodnota chýba", nikdy
 * ako prázdny reťazec.
 */
export function desifruj(ulozene: string): string | null {
  try {
    const [prefix, iv, tag, sifra] = ulozene.split(":");
    if (prefix !== PREFIX || !iv || !tag || !sifra) return null;
    const d = crypto.createDecipheriv("aes-256-gcm", odvodenyKluc(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return Buffer.concat([d.update(Buffer.from(sifra, "base64")), d.final()]).toString("utf8");
  } catch {
    return null;
  }
}

/**
 * Náhľad hodnoty pre administráciu. Ukáže toľko, aby sa dali dva kľúče od
 * seba rozoznať, ale nie natoľko, aby sa dal ten pravý zneužiť.
 */
export function nahlad(hodnota: string): string {
  const t = hodnota.trim();
  if (t.startsWith("-----BEGIN")) {
    const typ = t.split("\n")[0].replace(/-+/g, "").trim();
    return `${typ} · ${t.length} znakov`;
  }
  if (t.length <= 8) return "••••";
  return `••••${t.slice(-4)}`;
}
