#!/usr/bin/env bash
# Obal pre nočnú zálohu z cronu. Drží zámok (dve zálohy naraz nemajú zmysel),
# píše do /opt/maxiticket/logs/zaloha.log a log si sám drží pod 2 MB.
set -euo pipefail

KOREN="/opt/maxiticket"
LOG="$KOREN/logs/zaloha.log"
ZAMOK="$KOREN/logs/.zaloha.lock"
NODE="$(command -v node || echo /usr/bin/node)"

mkdir -p "$KOREN/logs"

# Log si netreba logrotate — pár riadkov denne, ale nech nerastie bez stropu.
if [ -f "$LOG" ] && [ "$(stat -c%s "$LOG")" -gt 2097152 ]; then
  mv -f "$LOG" "$LOG.1"
fi

# -n: ak už jedna záloha beží, táto sa tichšie preskočí, než aby sa tlačili dve.
exec 9>"$ZAMOK"
if ! flock -n 9; then
  echo "$(date -Is) [zaloha-cron] iná záloha ešte beží, preskakujem" >>"$LOG"
  exit 0
fi

{
  echo "$(date -Is) [zaloha-cron] štart"
  if "$NODE" "$KOREN/app/scripts/zaloha-db.mjs"; then
    echo "$(date -Is) [zaloha-cron] koniec, v poriadku"
  else
    kod=$?
    echo "$(date -Is) [zaloha-cron] ZLYHALO s kódom $kod"
    exit "$kod"
  fi
} >>"$LOG" 2>&1
