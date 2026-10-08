// IP klienta spoza nginxu — jedno miesto pre brzdy.
//
// Berieme `X-Real-IP`, ktorý nginx nastavuje na `$remote_addr`, a teda prepíše
// čokoľvek, čo poslal klient. `X-Forwarded-For` je zoznam, do ktorého nginx len
// pripája — jeho *prvá* položka pochádza od klienta a dá sa podvrhnúť, preto
// z neho berieme poslednú. Keby sa to pokazilo, brzdy by sa dali obísť
// podvrhnutou hlavičkou.
//
// Tú istú funkciu majú zatiaľ lokálne aj `payments`, `coupons`, `support`
// a `waitlist`. Sú zhodné (overené), takže to nie je diera — len duplikát,
// ktorý sem patrí. Prepísať ich na tento modul je na samostatnú úpravu;
// peňažnú cestu pred spustením predaja zbytočne nerozhrabávam.
import { getRequest } from "@tanstack/react-start/server";

export function clientIp(): string {
  try {
    const h = getRequest()?.headers;
    const real = h?.get("x-real-ip");
    if (real) return real.trim();
    const fwd = h?.get("x-forwarded-for");
    if (fwd) {
      const parts = fwd.split(",");
      return parts[parts.length - 1].trim() || "unknown";
    }
  } catch {
    /* mimo requestu (napr. cron) — limit sa potom viaže na "unknown" */
  }
  return "unknown";
}
