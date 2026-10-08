// IP klienta spoza nginxu — jedno miesto pre brzdy.
//
// Berieme `X-Real-IP`, ktorý nginx nastavuje na `$remote_addr`, a teda prepíše
// čokoľvek, čo poslal klient. `X-Forwarded-For` je zoznam, do ktorého nginx len
// pripája — jeho *prvá* položka pochádza od klienta a dá sa podvrhnúť, preto
// z neho berieme poslednú. Keby sa to pokazilo, brzdy by sa dali obísť
// podvrhnutou hlavičkou.
import { getRequest } from "@tanstack/react-start/server";
import { jeVerejnaIp } from "./ip";

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
    /* mimo requestu (napr. cron) — adresa sa potom neurčí */
  }
  return "unknown";
}

/**
 * Kľúč brzdy podľa IP — alebo `null`, keď sa na tej adrese brzdiť nedá.
 *
 * `null` vráti vtedy, keď adresa nerozlišuje volajúcich: keď je súkromná,
 * loopback alebo sa vôbec neurčila. To nie je teoretická možnosť — **8. 10.
 * 2026 sa zistilo, že OPNsense prepisuje zdrojovú adresu a nginx vidí pri
 * každej požiadavke `192.168.1.1`.** Dovtedy všetky brzdy na IP ticho merali
 * celý web ako jedného návštevníka, takže napríklad „20 objednávok na IP za
 * hodinu" znamenalo 20 objednávok za hodinu pre všetkých dohromady.
 *
 * Volajúci si preto musí poradiť aj bez kľúča — buď brzdiť na identite
 * (e-mail, relácia), alebo použiť voľnejší spoločný strop. Keď sa perimeter
 * opraví, kľúče začnú vznikať samé a brzdy sa zapnú bez zmeny kódu.
 */
export function ipBucket(prefix: string): string | null {
  const ip = clientIp();
  return jeVerejnaIp(ip) ? `${prefix}${ip}` : null;
}
