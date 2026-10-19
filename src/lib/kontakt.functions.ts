// Odoslanie správy z kontaktného formulára.
//
// Formulár predtým nikam neodosielal: po 600 ms zobrazil „Správa odoslaná.
// Ozveme sa do 24 hodín." a správu zahodil. Kto nám písal o refundáciu,
// odchádzal s pokojom a bez odpovede.
//
// Správa ide e-mailom na adresu podpory. Keď pošta nie je nastavená,
// vraciame to po pravde — nech sa zákazník dozvie, že má napísať priamo.
//
// BRZDY: perimeter dnes zlieva všetky IP na jednu, takže strop na adresu
// nefunguje a padá sa na spoločný. Preto sú tri a nie jedna — relácia
// prehliadača, e-mail pisateľa a až nakoniec spoločný strop. K tomu pasca
// na roboty: skryté pole, ktoré človek nevyplní.
import { createServerFn } from "@tanstack/react-start";
import { z } from "zod";
import { supabaseAdmin } from "@/integrations/supabase/client.server";
import { ipBucket } from "./client-ip.server";
import { sendMail } from "./mailer.server";
import { PREVADZKOVATEL } from "./kontakt";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Vyplnené skryté pole = robot.
 *
 * Pole je v stránke odsunuté mimo obrazovky (nie `display:none` — na to si
 * časť robotov dáva pozor) a človek sa k nemu nedostane ani tabulátorom.
 */
export function vyplnenaPast(web: string | null | undefined): boolean {
  return typeof web === "string" && web.trim() !== "";
}

async function limituj(bucket: string, limit: number, sekundy: number, sprava: string) {
  const { data: allowed, error } = await supabaseAdmin.rpc("hit_rate_limit", {
    p_bucket: bucket,
    p_limit: limit,
    p_window_seconds: sekundy,
  });
  if (error) {
    // Výpadok počítadla nesmie zhodiť odoslanie — limit je ochrana, nie kritická cesta.
    console.error("rate limit zlyhal", bucket, error.message);
    return;
  }
  if (allowed === false) throw new Error(sprava);
}

export type VysledokKontaktu = { ok: true } | { ok: false; dovod: "posta-nenastavena" };

export const posliKontaktnuSpravu = createServerFn({ method: "POST" })
  .inputValidator((input) =>
    z
      .object({
        meno: z.string().trim().min(2).max(100),
        email: z.string().trim().email().max(200),
        tema: z.string().trim().min(2).max(150),
        sprava: z.string().trim().min(10).max(5000),
        // Id relácie z `sessionStorage` — to isté, ktorým sa držia sedadlá.
        session: z.string().trim().min(6).max(80).optional(),
        // Pasca: človek ju nevyplní. Posiela sa vždy, aby nebolo vidieť, že ide o pascu.
        web: z.string().max(200).optional(),
      })
      .parse(input),
  )
  .handler(async ({ data }): Promise<VysledokKontaktu> => {
    // Robota netreba poúčať: tvárime sa, že odoslané, a správu zahodíme.
    if (vyplnenaPast(data.web)) return { ok: true };

    // Bez použiteľnej adresy spoločný strop — pozri `ipBucket`. Je 40, nie 200:
    // je to posledná záchrana a schránka podpory nemá byť zaplaviteľná.
    const kluceIp = ipBucket("kontakt:ip:");
    await limituj(
      kluceIp ?? "kontakt:spolocne",
      kluceIp ? 10 : 40,
      3600,
      "Príliš veľa správ. Skús to prosím o chvíľu.",
    );
    // Relácia prehliadača: robot si ju vie meniť, ale musí sa o to snažiť.
    if (data.session) {
      await limituj(
        `kontakt:ses:${data.session}`,
        3,
        3600,
        "Z tohto prehliadača už odišli tri správy. Ozveme sa na ne.",
      );
    }
    const email = data.email.toLowerCase();
    await limituj(
      `kontakt:email:${email}`,
      5,
      3600,
      "Z tejto adresy už prišlo viac správ. Ozveme sa na tie predchádzajúce.",
    );

    const html = `
      <p><strong>Téma:</strong> ${escapeHtml(data.tema)}</p>
      <p><strong>Od:</strong> ${escapeHtml(data.meno)} &lt;${escapeHtml(email)}&gt;</p>
      <hr />
      <p style="white-space:pre-wrap">${escapeHtml(data.sprava)}</p>
    `.trim();
    const text = `Téma: ${data.tema}\nOd: ${data.meno} <${email}>\n\n${data.sprava}`;

    const vysledok = await sendMail({
      to: PREVADZKOVATEL.email,
      subject: `Kontakt z webu: ${data.tema}`,
      html,
      text,
    });

    if (!vysledok.ok) {
      if (vysledok.reason === "not_configured") return { ok: false, dovod: "posta-nenastavena" };
      throw new Error(
        "Správu sa nepodarilo odoslať. Napíš nám prosím priamo na " + PREVADZKOVATEL.email,
      );
    }
    return { ok: true };
  });
