#!/usr/bin/env bash
# WOLTSMS — cURL örneği
# Kullanım: WOLTSMS_API_KEY="wsk_live_290e1bb...TAM_ANAHTAR" ./curl.sh 905300000000 "Merhaba WOLTSMS!"

BASE_URL="https://woltsms.vercel.app"
API_KEY="${WOLTSMS_API_KEY:?WOLTSMS_API_KEY tanımlı değil (panelde üretilen tam anahtar)}"
TO="${1:-905300000000}"
MSG="${2:-Merhaba WOLTSMS!}"

echo "--- Bakiye ---"
curl -s "$BASE_URL/api/v1/balance" \
  -H "Authorization: Bearer $API_KEY"
echo

echo "--- SMS gönder ---"
curl -s -X POST "$BASE_URL/api/v1/sms/send" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $API_KEY" \
  -H "Idempotency-Key: $(date +%s)-$RANDOM" \
  -d "{\"recipients\":[\"$TO\"],\"message\":\"$MSG\",\"callback_url\":\"https://woltsms.vercel.app/sms-callback\"}"
echo
