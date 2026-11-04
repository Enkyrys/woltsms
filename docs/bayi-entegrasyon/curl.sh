#!/usr/bin/env bash
# WOLTSMS — cURL örneği
# Kullanım:
#   WOLTSMS_API_KEY="wsk_live_...TAM_ANAHTAR" ./curl.sh 905300000000 "Merhaba WOLTSMS!"
# İsteğe bağlı imza: WOLTSMS_API_SECRET="wss_..." (varsa X-Signature otomatik eklenir)

BASE_URL="https://woltsms.vercel.app"
API_KEY="${WOLTSMS_API_KEY:?WOLTSMS_API_KEY tanımlı değil (panelde üretilen tam anahtar)}"
TO="${1:-905300000000}"
MSG="${2:-Merhaba WOLTSMS!}"

echo "--- Bağlantı kontrolü ---"
CONN=$(curl -s -w "\n%{http_code}" "$BASE_URL/api/v1/connection" -H "Authorization: Bearer $API_KEY")
CODE=$(echo "$CONN" | tail -n1); BODY=$(echo "$CONN" | sed '$d')
echo "$BODY"
if [ "$CODE" != "200" ]; then echo ">> Bağlantı yok (HTTP $CODE)"; exit 1; fi
echo ">> Bağlandı"

echo "--- SMS gönder ---"
PAYLOAD="{\"recipients\":[\"$TO\"],\"message\":\"$MSG\"}"
SIG_HEADER=()
if [ -n "$WOLTSMS_API_SECRET" ]; then
  SIG=$(printf '%s' "$PAYLOAD" | openssl dgst -sha256 -hmac "$WOLTSMS_API_SECRET" -hex | sed 's/^.* //')
  SIG_HEADER=(-H "X-Signature: $SIG")
fi
curl -s -X POST "$BASE_URL/api/v1/sms/send" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Idempotency-Key: $(date +%s)-$RANDOM" \
  "${SIG_HEADER[@]}" \
  -d "$PAYLOAD"
echo
