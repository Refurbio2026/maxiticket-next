// Emailové šablóny — vstavané znenie a jednoduchý renderer.
//
// Tento súbor je izomorfný (žiadny server-only import), aby si admin stránka
// vedela ukázať náhľad tým istým kódom, ktorý e-mail naozaj odošle. Čítanie
// šablóny z databázy je v `email-templates.server.ts`.
//
// Zámerne to nie je šablónovací jazyk: podporujeme `{{kľúč}}` a `{{#if kľúč}}
// … {{/if}}`. Viac na e-mail netreba a menej sa toho pokazí.

export type TemplateVars = Record<string, string | number | null | undefined>;

export type TemplateKey = "tickets" | "refund";

export type TemplateDefinition = {
  key: TemplateKey;
  name: string;
  description: string;
  subject: string;
  html: string;
  text: string;
  /** Zoznam pre nápovedu v admine: kľúč → čo znamená. */
  variables: { key: string; label: string; example: string }[];
};

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || String(value).trim() === "";
}

/**
 * Dosadí premenné do šablóny.
 *
 * `escape = true` (HTML telo) hodnoty escapuje — meno zákazníka ani názov
 * podujatia nesmú rozbiť značky. Pri predmete e-mailu escapovať netreba.
 */
export function renderTemplate(
  source: string,
  vars: TemplateVars,
  opts?: { escape?: boolean },
): string {
  const escape = opts?.escape !== false;

  // Najprv podmienené bloky, nech sa nedosadí nič do vyhodenej časti.
  const withBlocks = source.replace(
    /\{\{#if\s+([a-z0-9_]+)\s*\}\}([\s\S]*?)\{\{\/if\}\}/gi,
    (_m, key: string, body: string) => (isEmpty(vars[key]) ? "" : body),
  );

  return withBlocks.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (_m, key: string) => {
    const value = vars[key];
    if (isEmpty(value)) return "";
    const str = String(value);
    return escape ? escapeHtml(str) : str;
  });
}

const TICKETS_HTML = `<!doctype html>
<html lang="sk"><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;color:#0f172a;">
  <div style="max-width:560px;margin:0 auto;padding:24px 16px;">
    <div style="background:#0f172a;color:#fff;padding:20px 24px;border-radius:8px 8px 0 0;">
      <div style="font-size:22px;font-weight:700;">vipky.sk</div>
    </div>
    <div style="background:#fff;padding:24px;border-radius:0 0 8px 8px;">
      <h1 style="margin:0 0 8px;font-size:20px;">Vstupenky sú tvoje 🎟️</h1>
      <p style="margin:0 0 16px;color:#475569;line-height:1.5;">
        Ahoj {{customer_name}}, platba prebehla v poriadku.
        {{ticket_sentence}} v prílohe tohto e-mailu ako PDF.
      </p>
      <table style="width:100%;border-collapse:collapse;font-size:14px;margin-bottom:20px;">
        {{#if event_title}}
        <tr><td style="padding:4px 0;color:#64748b;">Podujatie</td><td style="padding:4px 0;font-weight:600;">{{event_title}}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Kedy</td><td style="padding:4px 0;">{{event_date}} · {{event_time}}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Kde</td><td style="padding:4px 0;">{{venue}}, {{city}}</td></tr>
        {{/if}}
        <tr><td style="padding:4px 0;color:#64748b;">Objednávka</td><td style="padding:4px 0;font-family:monospace;">{{order_short}}</td></tr>
        <tr><td style="padding:4px 0;color:#64748b;">Zaplatené</td><td style="padding:4px 0;font-weight:600;">{{total}} {{currency}}</td></tr>
      </table>
      <a href="{{tickets_url}}" style="display:inline-block;background:#0f172a;color:#fff;text-decoration:none;padding:12px 20px;border-radius:6px;font-weight:600;">
        Zobraziť vstupenky online
      </a>
      {{#if invoice_url}}
      <p style="margin:16px 0 0;font-size:13px;"><a href="{{invoice_url}}" style="color:#2563eb;">Stiahnuť faktúru (PDF)</a></p>
      {{/if}}
      <p style="margin:20px 0 0;font-size:13px;color:#64748b;line-height:1.5;">
        Pri vstupe stačí ukázať QR kód z mobilu alebo vytlačenú vstupenku.
        Otázky? Napíš na <a href="mailto:support@vipky.sk" style="color:#2563eb;">support@vipky.sk</a>.
      </p>
    </div>
  </div>
</body></html>`;

const REFUND_HTML = `<!doctype html>
<html lang="sk"><body style="font-family:Arial,sans-serif;background:#fff;padding:24px;color:#111">
<h2 style="margin:0 0 12px">Refund spracovaný</h2>
<p>Dobrý deň {{customer_name}},</p>
<p>refund za vašu objednávku <strong>#{{order_short}}</strong> bol úspešne spracovaný.</p>
<table style="border-collapse:collapse;margin:16px 0">
  <tr><td style="padding:4px 12px 4px 0;color:#666">Suma:</td><td><strong>{{amount}} {{currency}}</strong></td></tr>
  <tr><td style="padding:4px 12px 4px 0;color:#666">Typ:</td><td>{{refund_type}}</td></tr>
  {{#if reason}}
  <tr><td style="padding:4px 12px 4px 0;color:#666;vertical-align:top">Dôvod:</td><td>{{reason}}</td></tr>
  {{/if}}
</table>
<p>Suma sa vráti na pôvodný spôsob platby (zvyčajne do 5 pracovných dní).</p>
<p style="color:#888;font-size:12px;margin-top:24px">vipky.sk</p>
</body></html>`;

/**
 * Vstavané znenie. Používa sa, kým šablóna v databáze nie je (alebo je vypnutá),
 * a admin sa naň vie kedykoľvek vrátiť tlačidlom „Obnoviť pôvodné".
 */
export const DEFAULT_TEMPLATES: Record<TemplateKey, TemplateDefinition> = {
  tickets: {
    key: "tickets",
    name: "Vstupenky po zaplatení",
    description: "Odchádza zákazníkovi hneď po pripísaní platby. V prílohe je PDF so vstupenkami.",
    subject: "Vstupenky: {{event_title}}",
    html: TICKETS_HTML,
    text: "Platba prebehla v poriadku. Vstupenky nájdeš v prílohe alebo online: {{tickets_url}}",
    variables: [
      { key: "customer_name", label: "Krstné meno zákazníka", example: "Peter" },
      { key: "order_short", label: "Skrátené číslo objednávky", example: "A1B2C3D4" },
      { key: "event_title", label: "Názov podujatia", example: "Symfonický koncert" },
      { key: "event_date", label: "Dátum konania", example: "2026-09-16" },
      { key: "event_time", label: "Čas začiatku", example: "19:00" },
      { key: "venue", label: "Miesto konania", example: "Historická budova SND" },
      { key: "city", label: "Mesto", example: "Bratislava" },
      { key: "ticket_count", label: "Počet vstupeniek", example: "2" },
      { key: "ticket_sentence", label: "Veta o počte vstupeniek", example: "2 vstupenky nájdeš" },
      { key: "total", label: "Zaplatená suma", example: "58.00" },
      { key: "currency", label: "Mena", example: "EUR" },
      { key: "tickets_url", label: "Odkaz na vstupenky online", example: "https://vipky.sk/…" },
      {
        key: "invoice_url",
        label: "Odkaz na faktúru (môže chýbať)",
        example: "https://…/faktura.pdf",
      },
    ],
  },
  refund: {
    key: "refund",
    name: "Potvrdenie refundácie",
    description: "Odchádza zákazníkovi, keď admin alebo organizátor vráti peniaze.",
    subject: "vipky.sk — refund objednávky #{{order_short}}",
    html: REFUND_HTML,
    text: "Refund za objednávku #{{order_short}} vo výške {{amount}} {{currency}} bol spracovaný.",
    variables: [
      { key: "customer_name", label: "Meno zákazníka", example: "Peter Novák" },
      { key: "order_short", label: "Skrátené číslo objednávky", example: "A1B2C3D4" },
      { key: "amount", label: "Vrátená suma", example: "29.00" },
      { key: "currency", label: "Mena", example: "EUR" },
      { key: "refund_type", label: "Plný alebo čiastočný refund", example: "Plný refund" },
      { key: "reason", label: "Dôvod (môže chýbať)", example: "Zrušené podujatie" },
    ],
  },
};

export const TEMPLATE_KEYS = Object.keys(DEFAULT_TEMPLATES) as TemplateKey[];
