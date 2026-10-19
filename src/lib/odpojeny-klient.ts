// Rozpoznanie klienta, ktorý zavrel spojenie uprostred vykresľovania.
//
// Oddelené od `server.ts` zámerne: ten je vstupný bod Nitra a v teste sa načítať
// nedá. Toto je čistá funkcia, takže sa dá overiť.
//
// Prečo vôbec: k 19. 10. 2026 bolo v chybovom logu **11 174 takých riadkov
// zo 7,1 MB** a prekrývali skutočné chyby, ktorých boli dve. Nie je to naša
// chyba — človek zatvoril kartu, odrolovoval inde, alebo to bol robot.

/** Je tá chyba len prerušené spojenie od klienta? */
export function jeOdpojenyKlient(error: unknown, hlbka = 0): boolean {
  if (!error || hlbka > 5) return false;
  const e = error as { name?: string; code?: string; message?: string; cause?: unknown };
  const popis = [e.name, e.code, e.message].filter(Boolean).join(" ");
  if (/AbortError|ECONNRESET|EPIPE|ERR_STREAM_PREMATURE_CLOSE|operation was aborted/i.test(popis)) {
    return true;
  }
  // Skutočný dôvod býva zabalený v `cause`, niekedy aj viac úrovní.
  return e.cause ? jeOdpojenyKlient(e.cause, hlbka + 1) : false;
}
