// Je adresa použiteľná na brzdenie?
//
// Brzdy v tomto projekte stoja na IP klienta. To má zmysel len vtedy, keď sa
// adresy návštevníkov od seba odlišujú. Keď perimeter prepisuje zdrojovú
// adresu (8. 10. 2026 sa zistilo, že OPNsense to robí — nginx vidí pri každej
// požiadavke `192.168.1.1`), spadnú **všetci do jedného kľúča** a z limitu
// „20 objednávok na IP za hodinu" sa stane „20 objednávok pre celý web za
// hodinu". To je horšie než žiadna brzda: útočníka nezastaví, ale poctivých
// kupujúcich áno.
//
// Preto sa adresa najprv overí a brzda na IP sa použije len vtedy, keď je
// adresa súkromná — teda rozlišuje jedného volajúceho od druhého. Keď sa
// perimeter opraví, brzdy sa zapnú samé, bez zmeny kódu.

/**
 * `true`, keď je adresa verejná, a teda rozlišuje volajúcich.
 *
 * Zdieľaný rozsah operátorov (`100.64.0.0/10`, CGNAT) sa **za použiteľný
 * považuje**: nie je to naša infrastruktúra a je to to najlepšie rozlíšenie,
 * aké o takom klientovi máme.
 */
export function jeVerejnaIp(ip: string | null | undefined): boolean {
  const s = (ip ?? "").trim().toLowerCase();
  if (!s || s === "unknown") return false;

  if (s.includes(":")) {
    if (s === "::1" || s === "::") return false;
    if (/^f[cd]/.test(s)) return false; // fc00::/7 — vnútorné adresy
    if (/^fe[89ab]/.test(s)) return false; // fe80::/10 — link-local
    return true;
  }

  const oktety = s.split(".");
  if (oktety.length !== 4) return false;
  const n = oktety.map((o) => (/^\d{1,3}$/.test(o) ? Number(o) : -1));
  if (n.some((x) => x < 0 || x > 255)) return false;

  const [a, b] = n;
  if (a === 0) return false; // neplatné
  if (a === 10) return false; // 10/8
  if (a === 127) return false; // loopback
  if (a === 169 && b === 254) return false; // link-local
  if (a === 172 && b >= 16 && b <= 31) return false; // 172.16/12
  if (a === 192 && b === 168) return false; // 192.168/16
  return true;
}
