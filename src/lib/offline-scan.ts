// Rozhodovanie skenera bez siete.
//
// PREČO: offline režim doteraz **pustil dovnútra kohokoľvek.** Keď nebola sieť,
// kód sa len uložil do frontu a čítačka zobrazila „valid" — bez akéhokoľvek
// overenia. Screenshot cudzej vstupenky, vymyslený kód aj tá istá vstupenka
// päťkrát prešli; databáza to odhalila až pri synchronizácii, teda po podujatí.
//
// AKO sa to dá overiť bez servera: QR nesie `MT2.<id vstupenky>.<podpis>`, takže
// **id sa z kódu prečíta aj bez tajomstva**. Podpis offline overiť nejde (na to
// treba serverový kľúč), ale nie je to potrebné — čítačka si pred podujatím
// stiahne zoznam id platných vstupeniek a overuje členstvo v ňom. Vymyslieť
// uuid, ktoré v tom zozname je, sa nedá.
//
// Staré vstupenky zo starého systému majú namiesto tokenu číselný kód; tie sa
// porovnávajú s druhým zoznamom (`kody`).
//
// ČO TO NEVYRIEŠI: dve čítačky offline o sebe nevedia, takže tá istá vstupenka
// môže prejsť na dvoch dverách. To je vlastnosť offline práce, nie chyba — server
// to odhalí pri synchronizácii a v prehľade skenov to bude vidieť.

export type ScanResult = "valid" | "duplicate" | "invalid" | "reentry" | "refunded";

/** Zoznam platných vstupeniek podujatia, stiahnutý dopredu. */
export type OfflineZasoba = {
  event_id: string;
  /** Id vstupeniek s podpísaným tokenom `MT2.*`, bez pomlčiek, malými písmenami. */
  ids: string[];
  /** Čisté kódy starých vstupeniek (zo starého systému). */
  kody: string[];
  /**
   * Čo už bolo naskenované podľa servera v čase stiahnutia — id aj staré kódy
   * v jednom zozname. Bez toho by vstupenka naskenovaná online pred výpadkom
   * offline vyšla ako platná, lebo lokálny zoznam použitých je prázdny.
   */
  pouzite: string[];
  /** Koľko vstupeniek zoznam pokrýva — len na zobrazenie obsluhe. */
  pocet?: number;
  /** Kedy sa zásoba stiahla — podľa toho sa pozná, že je stará. */
  stiahnute: string;
};

export type OfflineRozhodnutie = {
  result: ScanResult;
  message: string;
  /** Čo sa má zapísať do zoznamu použitých na tomto zariadení. */
  kluc: string | null;
};

/**
 * Id vstupenky z naskenovaného kódu, alebo `null`, keď to nie je token `MT2.*`.
 * Rovnaký tvar, aký kontroluje `verifyTicket` na serveri — len bez podpisu.
 */
export function idZTokenu(kod: string): string | null {
  const casti = (kod || "").trim().split(".");
  if (casti.length !== 3 || casti[0] !== "MT2") return null;
  const id = casti[1];
  return /^[0-9a-f]{32}$/i.test(id) ? id.toLowerCase() : null;
}

/** Na čo sa kód premení pri porovnávaní — id tokenu, inak kód ako taký. */
export function klucKodu(kod: string): string {
  return idZTokenu(kod) ?? (kod || "").trim();
}

/** Je zásoba staršia než `hodin`? Starú treba pred podujatím obnoviť. */
export function jeZasobaStara(
  zasoba: OfflineZasoba | null,
  hodin = 12,
  teraz = Date.now(),
): boolean {
  if (!zasoba?.stiahnute) return true;
  const vek = teraz - new Date(zasoba.stiahnute).getTime();
  return !(vek >= 0) || vek > hodin * 3_600_000;
}

/**
 * Rozhodne o naskenovanom kóde bez siete.
 *
 * Bez stiahnutej zásoby sa **nerozhoduje** — vráti `invalid` s jasnou hláškou,
 * aby obsluha vedela, že čítačku treba pripojiť. To je zámer: tvrdiť „valid"
 * bez akéhokoľvek podkladu je presne tá chyba, ktorú to opravuje.
 */
export function rozhodniOffline(vstup: {
  kod: string;
  zasoba: OfflineZasoba | null;
  pouzite: string[];
  povolitOpakovanyVstup?: boolean;
}): OfflineRozhodnutie {
  const kod = (vstup.kod || "").trim();
  if (!kod) return { result: "invalid", message: "Prázdny kód.", kluc: null };

  if (!vstup.zasoba) {
    return {
      result: "invalid",
      message: "Bez siete a bez stiahnutého zoznamu vstupeniek — pripoj čítačku a skús znova.",
      kluc: null,
    };
  }

  const kluc = klucKodu(kod);
  const idZnamy = new Set(vstup.zasoba.ids.map((x) => x.toLowerCase()));
  const kodZnamy = new Set(vstup.zasoba.kody.map((x) => x.trim()));
  const pouziteZnamy = new Set(vstup.zasoba.pouzite.map((x) => x.trim().toLowerCase()));
  const patriPodujatiu =
    idZnamy.has(kluc.toLowerCase()) || kodZnamy.has(kluc) || pouziteZnamy.has(kluc.toLowerCase());

  if (!patriPodujatiu) {
    return {
      result: "invalid",
      message: "Vstupenka nepatrí k tomuto podujatiu.",
      kluc: null,
    };
  }

  // Použité = čo vie server (v čase stiahnutia) plus čo sme naskenovali my
  // od výpadku.
  const uzPouzita = [...vstup.zasoba.pouzite, ...vstup.pouzite].some(
    (x) => x.toLowerCase() === kluc.toLowerCase(),
  );
  if (uzPouzita) {
    return vstup.povolitOpakovanyVstup
      ? { result: "reentry", message: "Opakovaný vstup — povolený.", kluc }
      : { result: "duplicate", message: "Táto vstupenka už bola naskenovaná.", kluc };
  }

  return { result: "valid", message: "Platná vstupenka (offline).", kluc };
}
