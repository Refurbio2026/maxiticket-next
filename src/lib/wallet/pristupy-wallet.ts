// Čo sa dá vložiť do políčok pre wallet certifikáty — a čo nie.
//
// Administrátor dostane od Apple súbor `.p12` a od Googlu súbor `.json`.
// Do databázy ale potrebujeme PEM (Apple), resp. samotný JSON (Google).
// Keď vloží niečo iné, musí sa to dozvedieť hneď — nie až o mesiac pri
// prvom zákazníkovi, ktorému pass nepôjde pridať do telefónu.

export type DruhVstupu = "pem" | "json" | "p12" | "nezrozumitelne";

export function rozpoznajVstup(text: string): DruhVstupu {
  const t = text.trim();
  if (!t) return "nezrozumitelne";
  // JSON sa kontroluje PRVÝ: servisný účet Google má privátny kľúč vo vnútri,
  // takže obsahuje „-----BEGIN PRIVATE KEY-----" a inak by vyšiel ako PEM.
  if (t.startsWith("{")) return "json";
  if (t.includes("-----BEGIN")) return "pem";
  // `.p12` je binárny PKCS#12; v base64 začína takmer vždy na „MII".
  if (/^MI[A-Za-z0-9+/=\s]+$/.test(t)) return "p12";
  return "nezrozumitelne";
}

export type Kontrola = { ok: true } | { ok: false; sprava: string };

/** Apple: certifikát aj privátny kľúč v jednom PEM. */
export function skontrolujApplePem(text: string): Kontrola {
  const druh = rozpoznajVstup(text);
  if (druh === "p12") {
    return {
      ok: false,
      sprava:
        "Toto vyzerá na súbor .p12. Preveď ho na PEM: openssl pkcs12 -in certifikat.p12 -out certifikat.pem -nodes -legacy",
    };
  }
  if (druh !== "pem") {
    return { ok: false, sprava: "Očakáva sa PEM — text začínajúci na -----BEGIN." };
  }
  if (!text.includes("CERTIFICATE")) {
    return { ok: false, sprava: "V PEM chýba certifikát (-----BEGIN CERTIFICATE-----)." };
  }
  if (!/BEGIN (RSA |EC )?PRIVATE KEY/.test(text)) {
    return {
      ok: false,
      sprava:
        "V PEM chýba privátny kľúč. Pri prevode z .p12 nepoužívaj -nokeys; bez kľúča sa pass nedá podpísať.",
    };
  }
  return { ok: true };
}

/** Apple WWDR: medzičlánok od Apple, teda samotný certifikát bez kľúča. */
export function skontrolujWwdr(text: string): Kontrola {
  const druh = rozpoznajVstup(text);
  if (druh !== "pem" || !text.includes("CERTIFICATE")) {
    return {
      ok: false,
      sprava:
        "Očakáva sa certifikát v PEM. Stiahni WWDR z Apple (.cer) a preveď: openssl x509 -inform der -in AppleWWDRCAG4.cer -out wwdr.pem",
    };
  }
  if (/BEGIN (RSA |EC )?PRIVATE KEY/.test(text)) {
    return { ok: false, sprava: "Toto obsahuje privátny kľúč — WWDR je len verejný certifikát." };
  }
  return { ok: true };
}

/** Google: servisný účet ako JSON s e-mailom a kľúčom. */
export function skontrolujServisnyUcet(text: string): Kontrola {
  if (rozpoznajVstup(text) !== "json") {
    return { ok: false, sprava: "Očakáva sa obsah súboru JSON zo servisného účtu Google." };
  }
  let sa: { client_email?: string; private_key?: string; type?: string };
  try {
    sa = JSON.parse(text) as typeof sa;
  } catch {
    return { ok: false, sprava: "Toto nie je platný JSON — vlož celý obsah súboru." };
  }
  if (!sa.client_email || !sa.private_key) {
    return { ok: false, sprava: "V JSON chýba client_email alebo private_key." };
  }
  if (sa.type && sa.type !== "service_account") {
    return { ok: false, sprava: `Toto je kľúč typu „${sa.type}", očakáva sa service_account.` };
  }
  return { ok: true };
}
