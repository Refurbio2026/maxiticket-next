#!/usr/bin/env bash
# Z certifikátu od Apple poskladá PEM, ktorý sa vkladá do administrácie.
#
# Apple vráti `pass.cer` (binárny DER) k žiadosti, ktorú sme mu poslali.
# Podpis passu potrebuje certifikát AJ privátny kľúč v jednom PEM — kľúč
# pritom zostáva na serveri a nikdy nikam neodchádza.
#
# Použitie:
#   scripts/apple-pass-pem.sh ~/Downloads/pass.cer [~/Downloads/AppleWWDRCAG4.cer]
#
# Výstup: dva súbory v /opt/maxiticket/secrets-backup/apple-wallet/
#   pass-cert-a-kluc.pem   → pole „Podpisový certifikát“ v admine
#   wwdr.pem               → pole „Apple WWDR“
set -euo pipefail

KDE="/opt/maxiticket/secrets-backup/apple-wallet"
KLUC="$KDE/pass.key"
CER="${1:-}"
WWDR="${2:-}"

[ -f "$KLUC" ] || { echo "Chýba privátny kľúč $KLUC — bez neho je certifikát nanič."; exit 1; }
[ -n "$CER" ] && [ -f "$CER" ] || { echo "Použitie: $0 cesta/k/pass.cer [cesta/k/AppleWWDRCAG4.cer]"; exit 1; }

# Apple dáva DER; ak by niekto poslal už PEM, zvládneme oboje.
if grep -q "BEGIN CERTIFICATE" "$CER" 2>/dev/null; then
  cp "$CER" "$KDE/pass-cert.pem"
else
  openssl x509 -inform der -in "$CER" -out "$KDE/pass-cert.pem"
fi

# Kontrola, že certifikát naozaj patrí k nášmu kľúču — inak by sa pass
# podpísal neplatne a chybu by sme videli až na telefóne.
C=$(openssl x509 -in "$KDE/pass-cert.pem" -pubkey -noout | openssl sha256 | awk '{print $2}')
K=$(openssl rsa -in "$KLUC" -pubout 2>/dev/null | openssl sha256 | awk '{print $2}')
[ "$C" = "$K" ] || { echo "Certifikát NEPATRÍ k uloženému kľúču. Nepokračujem."; exit 1; }

cat "$KDE/pass-cert.pem" "$KLUC" > "$KDE/pass-cert-a-kluc.pem"
chmod 600 "$KDE/pass-cert-a-kluc.pem"
echo "hotovo: $KDE/pass-cert-a-kluc.pem"
openssl x509 -in "$KDE/pass-cert.pem" -noout -subject -enddate | sed 's/^/  /'

if [ -n "$WWDR" ] && [ -f "$WWDR" ]; then
  if grep -q "BEGIN CERTIFICATE" "$WWDR" 2>/dev/null; then cp "$WWDR" "$KDE/wwdr.pem";
  else openssl x509 -inform der -in "$WWDR" -out "$KDE/wwdr.pem"; fi
  echo "hotovo: $KDE/wwdr.pem"
  openssl x509 -in "$KDE/wwdr.pem" -noout -subject -enddate | sed 's/^/  /'
fi
