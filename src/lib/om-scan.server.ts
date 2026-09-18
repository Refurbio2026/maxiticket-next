// Skenovanie vstupeniek starého systému (OM) našou čítačkou.
//
// Vetva sa použije až vtedy, keď kód nesedí na žiadnu našu vstupenku. Staré
// vstupenky majú číselný čiarový kód, nie podpísaný `MT2.<uuid>.<hmac>`, takže
// sa tie dve vetvy nemôžu pomýliť.
//
// Tri veci, ktoré musia platiť, inak to nie je bezpečné:
//
//  1. **Hľadá sa v rámci podujatia**, nikdy globálne — 849 čiarových kódov sa
//     v OM opakuje vo viacerých predstaveniach a globálne hľadanie by pustilo
//     vstupenku na iný termín.
//  2. **Len potvrdená väzba** (`om_event_map.status = 'confirmed'`). Návrh
//     automatického párovania dvere neotvorí.
//  3. **Prvé použitie je atomické** — rozhoduje unikátny index v databáze,
//     nie kontrola v kóde. Dva súbežné skeny toho istého miesta tak nemôžu
//     obidva skončiť ako `valid`.
//
// Sken sa do OM **nezapisuje** (máme tam len čítanie), takže stará čítačka
// o ňom nevie. Na podujatí sa preto smie skenovať len jednou.

import { supabaseAdmin } from "@/integrations/supabase/client.server";

export type OmScanResult = "valid" | "duplicate" | "reentry" | "refunded" | "invalid";

export type OmScanOdpoved = {
  ok: boolean;
  result: OmScanResult;
  message: string;
  source: "om";
  seat_label?: string;
  id_seat?: number;
};

type Najdena = {
  id_seat: number;
  id_plan: number;
  event_date_id: string | null;
  category: string;
  suspicious: boolean;
  vanished_at: string | null;
  seat_label: string | null;
  price: number | null;
  uz_skenovana_v_om: boolean;
  skenovana_u_nas_at: string | null;
  refundovana: boolean;
};

/** Číselný kód zo starej vstupenky. Čokoľvek iné do tejto vetvy nepatrí. */
export function jeOmCiarovyKod(token: string): boolean {
  return /^\d{4,18}$/.test(token.trim());
}

async function zapisSken(r: {
  najdena: Najdena;
  eventId: string;
  barcode: number;
  result: OmScanResult;
  scannedBy: string | null;
  scannerName: string | null;
  userAgent: string | null;
}): Promise<{ konflikt: boolean }> {
  const { error } = await supabaseAdmin.from("om_ticket_scans").insert({
    id_seat: r.najdena.id_seat,
    id_plan: r.najdena.id_plan,
    barcode: r.barcode,
    event_id: r.eventId,
    event_date_id: r.najdena.event_date_id,
    result: r.result,
    scanned_by: r.scannedBy,
    scanner_name: r.scannerName,
    user_agent: r.userAgent,
  });
  // 23505 = unique_violation na `om_ticket_scans_prve_pouzitie`: niekto bol
  // rýchlejší. To nie je chyba zápisu, to je odpoveď — vstupenka je použitá.
  if (error?.code === "23505") return { konflikt: true };
  if (error) throw new Error(error.message);
  return { konflikt: false };
}

/**
 * Pokus o sken starej vstupenky. `null` znamená „toto nie je vstupenka
 * z OM" — volajúci vtedy pokračuje svojou pôvodnou hláškou.
 */
export async function skenujOmVstupenku(opts: {
  token: string;
  eventId: string;
  allowReentry: boolean;
  scannedBy: string | null;
  scannerName: string | null;
  userAgent: string | null;
}): Promise<OmScanOdpoved | null> {
  const token = opts.token.trim();
  if (!jeOmCiarovyKod(token)) return null;

  const barcode = Number(token);
  if (!Number.isSafeInteger(barcode)) return null;

  const { data, error } = await supabaseAdmin.rpc("om_najdi_vstupenku", {
    p_event_id: opts.eventId,
    p_barcode: barcode,
  });
  if (error) throw new Error(`om_najdi_vstupenku: ${error.message}`);

  const najdena = (data as Najdena[] | null)?.[0];
  if (!najdena) return null;

  const spolocne = {
    source: "om" as const,
    seat_label: najdena.seat_label ?? undefined,
    id_seat: najdena.id_seat,
  };
  const odpovedaj = async (result: OmScanResult, message: string, ok: boolean) => {
    await zapisSken({
      najdena,
      eventId: opts.eventId,
      barcode,
      result,
      scannedBy: opts.scannedBy,
      scannerName: opts.scannerName,
      userAgent: opts.userAgent,
    }).catch(() => ({ konflikt: false }));
    return { ok, result, message, ...spolocne };
  };

  // Predstavenie zrušené alebo miesto zo zdroja zmizlo.
  if (najdena.vanished_at) {
    return odpovedaj("invalid", "Vstupenka už v starom systéme neexistuje", false);
  }
  // Vrátené peniaze majú prednosť pred všetkým ostatným — aj pred tým, že
  // vstupenka už raz prešla.
  if (najdena.refundovana) {
    return odpovedaj("refunded", "Vstupenka bola refundovaná", false);
  }
  // Stav 15 s nulovou cenou je zrušená rezervácia z turniketu, nie predaj.
  if (najdena.suspicious) {
    return odpovedaj("invalid", "Vstupenka nie je platný predaj", false);
  }
  if (najdena.category === "free") {
    return odpovedaj("invalid", "Vstupenka bola stornovaná", false);
  }
  if (najdena.category !== "sold" && najdena.category !== "abo") {
    return odpovedaj("invalid", "Miesto nie je predané", false);
  }

  // Už použitá — či už našou čítačkou, alebo starou pred prechodom.
  const uzPouzita = najdena.uz_skenovana_v_om || najdena.skenovana_u_nas_at !== null;
  if (uzPouzita) {
    if (opts.allowReentry) {
      return odpovedaj("reentry", "Opakovaný vstup povolený", true);
    }
    const kde = najdena.uz_skenovana_v_om ? "v starom systéme" : "touto čítačkou";
    return odpovedaj("duplicate", `Vstupenka už bola skontrolovaná ${kde}`, false);
  }

  // Prvé použitie. O tom, či prejde, rozhoduje unikátny index — nie kontrola
  // vyššie, medzi ktorú a zápis sa zmestí súbežný sken.
  const { konflikt } = await zapisSken({
    najdena,
    eventId: opts.eventId,
    barcode,
    result: "valid",
    scannedBy: opts.scannedBy,
    scannerName: opts.scannerName,
    userAgent: opts.userAgent,
  });
  if (konflikt) {
    if (opts.allowReentry) return odpovedaj("reentry", "Opakovaný vstup povolený", true);
    return odpovedaj("duplicate", "Vstupenka už bola skontrolovaná touto čítačkou", false);
  }

  return { ok: true, result: "valid", message: "Vstupenka je platná", ...spolocne };
}
