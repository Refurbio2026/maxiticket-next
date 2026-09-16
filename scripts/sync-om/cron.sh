#!/bin/bash
#
# Obal pre cron. Jediné miesto, kde sa rozhoduje, kam sa loguje — cron riadky
# tak ostanú krátke a politika logov je na jednom mieste.
#
#   ./scripts/sync-om/cron.sh A
#
# Adresár logu: `OM_SYNC_LOG_DIR`, inak `/var/log/om-sync` (ak sa doň dá písať),
# inak `/opt/maxiticket/logs/om-sync`. Vďaka poslednej možnosti sync beží aj
# predtým, než niekto s právami založí `/var/log/om-sync`.

set -u
cd /opt/maxiticket/app || exit 1

KANAL="${1:?použitie: cron.sh <kanál>}"

if [ -n "${OM_SYNC_LOG_DIR:-}" ]; then
  LOG_DIR="$OM_SYNC_LOG_DIR"
elif [ -w /var/log/om-sync ] 2>/dev/null; then
  LOG_DIR=/var/log/om-sync
else
  LOG_DIR=/opt/maxiticket/logs/om-sync
fi
mkdir -p "$LOG_DIR" 2>/dev/null || LOG_DIR=/tmp

# Kanály C1–C3 zdieľajú jeden log, inak by z troch malých úloh boli tri súbory.
SUBOR="$(printf '%s' "$KANAL" | tr 'A-Z' 'a-z' | sed 's/^c[123]$/c/')"

exec >>"$LOG_DIR/$SUBOR.log" 2>&1
exec node scripts/sync-om/sync-om.js --channel="$KANAL"
