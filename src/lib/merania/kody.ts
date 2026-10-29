// Meracie kódy Google a Meta — čisté skladanie a kontrola.
//
// BEZPEČNOSŤ JE TU HLAVNÁ VEC. Identifikátory zadáva človek v administrácii
// a končia vo vnútri `<script>` na každej stránke. Keby sa vkladali tak,
// ako prišli, stačilo by do poľa „GA4 ID" napísať
//     G-X");alert(document.cookie);("
// a útočník s prístupom do admina by mal vlastný JavaScript na celom webe,
// vrátane pokladne. Preto sa KAŽDÝ identifikátor overuje proti presnému
// tvaru a čokoľvek iné sa zahodí — nie escapuje, zahodí.
//
// Tvary sú dané poskytovateľmi:
//   GA4            G-XXXXXXXXXX        (G- a 8–12 znakov A–Z0–9)
//   Google Ads     AW-123456789        (AW- a 9–12 číslic)
//   konverzia      abcDEF_ghIJ         (návestie, A–Z a–z 0–9 _ -)
//   GTM            GTM-XXXXXXX
//   Meta Pixel     15 číslic (býva 15–16)

export const VZORY = {
  ga4: /^G-[A-Z0-9]{8,12}$/,
  googleAds: /^AW-[0-9]{9,12}$/,
  konverznaNavestie: /^[A-Za-z0-9_-]{6,40}$/,
  gtm: /^GTM-[A-Z0-9]{5,10}$/,
  metaPixel: /^[0-9]{10,20}$/,
} as const;

export type TypKodu = keyof typeof VZORY;

/** Platný identifikátor, alebo `null`. Nič medzi tým. */
export function overId(typ: TypKodu, hodnota: string | null | undefined): string | null {
  const t = (hodnota ?? "").trim();
  if (!t) return null;
  return VZORY[typ].test(t) ? t : null;
}

export type Merania = {
  ga4?: string | null;
  gtm?: string | null;
  googleAds?: string | null;
  konverznaNavestie?: string | null;
  metaPixel?: string | null;
};

/** Prefiltrované nastavenia — čo neprejde kontrolou, akoby nebolo. */
export function overMerania(m: Merania): Merania {
  return {
    ga4: overId("ga4", m.ga4),
    gtm: overId("gtm", m.gtm),
    googleAds: overId("googleAds", m.googleAds),
    konverznaNavestie: overId("konverznaNavestie", m.konverznaNavestie),
    metaPixel: overId("metaPixel", m.metaPixel),
  };
}

/** Je vôbec čo spúšťať? */
export function maCoMerat(m: Merania): boolean {
  const o = overMerania(m);
  return !!(o.ga4 || o.gtm || o.googleAds || o.metaPixel);
}

/**
 * Úvodný skript Google Consent Mode v2.
 *
 * Musí byť PRED načítaním gtag.js, inak tag chvíľu beží s predvoleným
 * `granted` a uloží identifikátory ešte pred rozhodnutím návštevníka.
 */
export function googleZaklad(stav: Record<string, "granted" | "denied">): string {
  const predvolby = Object.entries(stav)
    .map(([k, v]) => `${k}:${JSON.stringify(v)}`)
    .join(",");
  return (
    "window.dataLayer=window.dataLayer||[];" +
    "function gtag(){dataLayer.push(arguments);}" +
    `gtag('consent','default',{${predvolby},wait_for_update:500});`
  );
}

/** Zmena súhlasu bez obnovenia stránky. */
export function googleAktualizacia(stav: Record<string, "granted" | "denied">): string {
  return `gtag('consent','update',${JSON.stringify(stav)});`;
}

/** Adresa gtag.js pre dané ID. Volá sa len s už overeným identifikátorom. */
export function gtagUrl(id: string): string {
  return `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(id)}`;
}

/** Spustenie GA4 a Google Ads nad už načítaným gtag.js. */
export function googleKonfig(m: Merania): string {
  const o = overMerania(m);
  const riadky: string[] = ["gtag('js',new Date());"];
  // `anonymize_ip` nie je v GA4 nastaviteľné (robí sa vždy), ale
  // `ads_data_redaction` pri odmietnutej reklame áno — nastavuje ho
  // Consent Mode sám, tu netreba nič.
  if (o.ga4) riadky.push(`gtag('config',${JSON.stringify(o.ga4)});`);
  if (o.googleAds) riadky.push(`gtag('config',${JSON.stringify(o.googleAds)});`);
  return riadky.join("");
}

/** Skript Google Tag Manageru. */
export function gtmSkript(id: string): string {
  const bezpecne = overId("gtm", id);
  if (!bezpecne) return "";
  return (
    "(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':new Date().getTime(),event:'gtm.js'});" +
    "var f=d.getElementsByTagName(s)[0],j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';" +
    "j.async=true;j.src='https://www.googletagmanager.com/gtm.js?id='+i+dl;" +
    `f.parentNode.insertBefore(j,f);})(window,document,'script','dataLayer',${JSON.stringify(bezpecne)});`
  );
}

/** Skript Meta Pixelu. Spúšťa sa len po súhlase s marketingom. */
export function metaSkript(id: string): string {
  const bezpecne = overId("metaPixel", id);
  if (!bezpecne) return "";
  return (
    "!function(f,b,e,v,n,t,s){if(f.fbq)return;n=f.fbq=function(){n.callMethod?" +
    "n.callMethod.apply(n,arguments):n.queue.push(arguments)};if(!f._fbq)f._fbq=n;" +
    "n.push=n;n.loaded=!0;n.version='2.0';n.queue=[];t=b.createElement(e);t.async=!0;" +
    "t.src=v;s=b.getElementsByTagName(e)[0];s.parentNode.insertBefore(t,s)}" +
    "(window,document,'script','https://connect.facebook.net/en_US/fbevents.js');" +
    `fbq('init',${JSON.stringify(bezpecne)});fbq('track','PageView');`
  );
}

export type Nakup = {
  /** Číslo objednávky — bez neho by sa konverzia počítala viackrát. */
  objednavka: string;
  suma: number;
  mena?: string;
};

/**
 * Konverzia „nákup".
 *
 * `transaction_id` aj `eventID` sú tam zámerne: podľa nich Google aj Meta
 * rozpoznajú, že ide o tú istú objednávku, keby sa stránka s potvrdením
 * obnovila. Bez nich by jeden nákup vyšiel ako tri.
 */
export function kodNakupu(m: Merania, n: Nakup): string {
  const o = overMerania(m);
  const mena = (n.mena || "EUR").toUpperCase();
  const suma = Math.round(n.suma * 100) / 100;
  const riadky: string[] = [];

  if (o.ga4) {
    riadky.push(
      `gtag('event','purchase',{transaction_id:${JSON.stringify(n.objednavka)},` +
        `value:${suma},currency:${JSON.stringify(mena)},send_to:${JSON.stringify(o.ga4)}});`,
    );
  }
  // Google Ads konverzia potrebuje okrem ID aj návestie; bez neho by sa
  // zaznamenala do nesprávnej akcie, tak sa radšej nepošle nič.
  if (o.googleAds && o.konverznaNavestie) {
    riadky.push(
      `gtag('event','conversion',{send_to:${JSON.stringify(`${o.googleAds}/${o.konverznaNavestie}`)},` +
        `value:${suma},currency:${JSON.stringify(mena)},transaction_id:${JSON.stringify(n.objednavka)}});`,
    );
  }
  if (o.metaPixel) {
    riadky.push(
      `if(window.fbq){fbq('track','Purchase',{value:${suma},currency:${JSON.stringify(mena)}},` +
        `{eventID:${JSON.stringify(n.objednavka)}});}`,
    );
  }
  return riadky.join("");
}
