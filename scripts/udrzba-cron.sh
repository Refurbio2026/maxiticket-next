#!/usr/bin/env bash
# Obal pre údržbovú routu z cronu — dvojička k `zaloha-cron.sh`.
#
# Jedna routa robí sedem vecí: stiahne bankové výpisy, spáruje transakcie,
# dopytuje stav platieb u brán bez webhooku, vybavuje lehoty prevodov, posiela
# pripomienky deň pred podujatím, upovedomuje čakajúcich a maže staré originály
# výpisov.
#
# Prečo obal a nie curl priamo v crontabe: tajomstvo by bolo vidieť
# v `crontab -l`. Takto si ho skript vezme z `/opt/maxiticket/.env` (práva 600).
#
# Volá sa na localhost, nie cez verejnú adresu — nezávisí to od DNS, TLS ani
# perimetra. Appka počúva na 127.0.0.1:3000, nginx pred ňou je len proxy.
set -euo pipefail

KOREN="/opt/maxiticket"
LOG="$KOREN/logs/udrzba.log"
ZAMOK="$KOREN/logs/.udrzba.lock"
ADRESA="http://127.0.0.1:3000/api/public/payments/reconcile"

mkdir -p "$KOREN/logs"

# Log si netreba logrotate, ale nech nerastie bez stropu.
if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG")" -gt 2097152 ]; then
  mv -f "$LOG" "$LOG.1"
fi

# -n: keď jeden beh ešte trvá, tento sa tichšie preskočí. Dopytovací sken má
# vlastný zámok na 45 minút, ale dva súbežné behy nemajú zmysel ani tak.
exec 9>"$ZAMOK"
if ! flock -n 9; then
  echo "$(date -Is) [udrzba] predošlý beh ešte trvá, preskakujem" >>"$LOG"
  exit 0
fi

TAJOMSTVO="$(grep -E '^RECONCILE_SECRET=' "$KOREN/.env" | cut -d= -f2- || true)"
if [ -z "$TAJOMSTVO" ]; then
  echo "$(date -Is) [udrzba] CHÝBA RECONCILE_SECRET v $KOREN/.env — routa je mŕtva a vracia 404" >>"$LOG"
  exit 1
fi

{
  echo "$(date -Is) [udrzba] štart"
  # -f: nenulový návratový kód pri 4xx/5xx, aby bolo zlyhanie vidieť v logu.
  # -m: strop na celý beh; dopytovanie u brány vie byť pomalé.
  if ODPOVED="$(curl -fsS -m 300 -H "x-reconcile-secret: $TAJOMSTVO" "$ADRESA")"; then
    # Odpoveď je JSON so stavom každého kroku. Do logu ide krátky súhrn —
    # celá odpoveď len pri zlyhaní. Pevný strop na znaky by nestačil: pri
    # skutočnej prevádzke odpoveď narastie (zoznam dopytovaných objednávok)
    # a odrezal by práve to, čo človek o tretej ráno hľadá.
    STAVY="$(printf '%s' "$ODPOVED" \
      | grep -oE '"[a-z]+":\{"stav":"[a-z]+"' \
      | sed 's/"//g; s/:{stav:/=/' | tr '\n' ' ')"
    if printf '%s' "$ODPOVED" | grep -q '"stav":"zlyhalo"'; then
      echo "$(date -Is) [udrzba] NIEKTORÝ KROK ZLYHAL: $STAVY"
      echo "$(date -Is) [udrzba] celá odpoveď: $ODPOVED"
    else
      echo "$(date -Is) [udrzba] koniec: $STAVY"
    fi
  else
    kod=$?
    echo "$(date -Is) [udrzba] ZLYHALO s kódom $kod (404 = chýba alebo nesedí tajomstvo)"
    exit "$kod"
  fi
} >>"$LOG" 2>&1
