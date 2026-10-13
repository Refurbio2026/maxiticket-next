#!/usr/bin/env bash
# Hodinová kontrola dvojitého predaja so starým systémom.
#
# Starý systém (OM) predáva ďalej a náš plán sály o tých miestach nevie, takže
# podujatie, ktoré bolo včera čisté, môže byť dnes kolízne. 8. 10. sa takto
# stiahlo 25 podujatí a **13. 10. pribudli ďalšie dve** — zopakovalo sa to za
# päť dní. Čakať, kým si to niekto všimne, znamená riskovať predaj obsadeného
# miesta.
#
# Logika je v `stiahnut-kolizne-podujatia.sql`, ktorý končí `rollback`, aby bol
# bezpečný aj keď ho spustí človek. Tento obal ho pustí dvakrát: najprv nasucho,
# aby zistil počet, a až potom naostro.
#
# Prečo nasucho najprv: počet sa dá prečítať z `UPDATE n` v jeho výstupe, takže
# podmienku „ktoré podujatia sú kolízne" netreba písať druhý raz. Keby sa raz
# zmenila v SQL, obal sa nerozíde.
set -euo pipefail

KOREN="/opt/maxiticket"
SQL="$KOREN/app/scripts/stiahnut-kolizne-podujatia.sql"
PSQL="$KOREN/restore/psql.sh"
LOG="$KOREN/logs/kolizie.log"
ZAMOK="$KOREN/logs/.kolizie.lock"

# Poistka proti chybe v dátach: keby sync alebo mapovanie zlyhali tak, že náhle
# „kolíznych" vyjde desiatky podujatí, nestiahneme katalóg potichu — radšej to
# nechá na človeka. Jednorazové veľké stiahnutie sa púšťa ručne.
STROP="${KOLIZIE_STROP:-5}"

mkdir -p "$KOREN/logs"
if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG")" -gt 2097152 ]; then
  mv -f "$LOG" "$LOG.1"
fi

exec 9>"$ZAMOK"
if ! flock -n 9; then
  echo "$(date -Is) [kolizie] predošlý beh ešte trvá, preskakujem" >>"$LOG"
  exit 0
fi

zapis() { echo "$(date -Is) [kolizie] $*" >>"$LOG"; }

# --- 1) nasucho: koľko by sa stiahlo -----------------------------------------
if ! NASUCHO="$("$PSQL" -v ON_ERROR_STOP=1 -f "$SQL" 2>&1)"; then
  zapis "ZLYHALO nasucho:"
  printf '%s\n' "$NASUCHO" | tail -5 >>"$LOG"
  exit 1
fi

POCET="$(printf '%s' "$NASUCHO" | grep -oE '^UPDATE [0-9]+' | tail -1 | awk '{print $2}')"
POCET="${POCET:-0}"

if [ "$POCET" = "0" ]; then
  zapis "nič na stiahnutie"
  exit 0
fi

if [ "$POCET" -gt "$STROP" ]; then
  zapis "POZOR: kolíznych je $POCET, čo je nad strop $STROP — NEROBÍM NIČ."
  zapis "Skontroluj ručne: $PSQL -f $SQL   (je nasucho). Strop zmeníš cez KOLIZIE_STROP."
  exit 1
fi

# --- 2) naostro --------------------------------------------------------------
if ! NAOSTRO="$(sed 's/^rollback;$/commit;/' "$SQL" | "$PSQL" -v ON_ERROR_STOP=1 2>&1)"; then
  zapis "ZLYHALO naostro (nič sa nezmenilo, je to jedna transakcia):"
  printf '%s\n' "$NAOSTRO" | tail -5 >>"$LOG"
  exit 1
fi

zapis "stiahnutých $POCET podujatí, dôvod je v audit_log ako stiahnute_kvoli_om:"
# Zo suchého výpisu vyberieme riadky so zoznamom — nech je v logu vidieť čo a kedy.
printf '%s' "$NASUCHO" \
  | sed -n '/TIETO sa stiahnu/,/^$/p' \
  | grep -vE "^(=|\s*$|-+\+|.*TIETO sa stiahnu)" \
  | sed 's/^/    /' >>"$LOG" || true
zapis "vrátiť sa dá skriptom vratit-kolizne-podujatia.sql"
