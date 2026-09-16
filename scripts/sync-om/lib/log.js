// Jednoduchý log na stdout. Cron si ho presmeruje do súboru, preto každý
// riadok začína časom a kanálom — bez toho sa v spoločnom logu nedá nič nájsť.

const uroven = { debug: 10, info: 20, warn: 30, error: 40 };
const prah = uroven[process.env.OM_SYNC_LOG_LEVEL ?? "info"] ?? uroven.info;

function zapis(u, kanal, sprava, detail) {
  if (uroven[u] < prah) return;
  const cas = new Date().toISOString();
  const d = detail === undefined ? "" : " " + JSON.stringify(detail);
  const riadok = `${cas} [${u.toUpperCase()}] [${kanal}] ${sprava}${d}`;
  if (u === "error" || u === "warn") console.error(riadok);
  else console.log(riadok);
}

export function logger(kanal) {
  return {
    debug: (s, d) => zapis("debug", kanal, s, d),
    info: (s, d) => zapis("info", kanal, s, d),
    warn: (s, d) => zapis("warn", kanal, s, d),
    error: (s, d) => zapis("error", kanal, s, d),
  };
}
