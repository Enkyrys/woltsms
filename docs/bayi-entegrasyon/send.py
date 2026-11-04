"""WOLTSMS — Python entegrasyonu (pip install requests)
Kullanım: WOLTSMS_API_KEY="wsk_live_...TAM_ANAHTAR" python send.py 905300000000 "Merhaba WOLTSMS!"
İsteğe bağlı imza: WOLTSMS_API_SECRET="wss_..."
"""
import hashlib
import hmac
import json as jsonlib
import os
import re
import sys
import uuid

import requests

BASE_URL = "https://woltsms.vercel.app"
CALLBACK_URL = "https://woltsms.vercel.app/sms-callback"  # isteğe bağlı: teslim raporu adresi
API_KEY = os.environ.get("WOLTSMS_API_KEY", "")
API_SECRET = os.environ.get("WOLTSMS_API_SECRET", "")

# 57 karakter: "wsk_live_" + 48 hex. Kısa ön ek (ör. wsk_live_b8ae809) ÇALIŞMAZ.
if not re.fullmatch(r"wsk_live_[0-9a-f]{48}", API_KEY):
    sys.exit("Bağlantı yok: WOLTSMS_API_KEY tam anahtar değil (wsk_live_ + 48 karakter olmalı).")


class WoltsmsError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code  # 401 anahtar · 402 bakiye · 403 IP · 422 doğrulama · 429 limit
        self.message = message


def _raw_call(method: str, path: str, payload: dict | None = None, idempotency_key: str | None = None) -> dict:
    headers = {"Authorization": f"Bearer {API_KEY}"}
    data = None
    if payload is not None:
        data = jsonlib.dumps(payload, ensure_ascii=False).encode("utf-8")
        headers["Content-Type"] = "application/json"
        headers["Idempotency-Key"] = idempotency_key or str(uuid.uuid4())
        if API_SECRET:
            headers["X-Signature"] = hmac.new(API_SECRET.encode(), data, hashlib.sha256).hexdigest()
    res = requests.request(method, BASE_URL + path, headers=headers, data=data, timeout=30)
    try:
        body = res.json()
    except ValueError:
        body = {"success": False, "code": res.status_code, "message": "Geçersiz yanıt"}
    body["_http"] = res.status_code
    return body


def _call(method: str, path: str, payload: dict | None = None, idempotency_key: str | None = None) -> dict:
    body = _raw_call(method, path, payload, idempotency_key)
    if not body.get("success"):
        raise WoltsmsError(body.get("code", body["_http"]), body.get("message", "Bilinmeyen hata"))
    return body["data"]


def check_connection() -> dict:
    """api_keys tablosunda anahtar kaydı varsa 'Bağlandı', yoksa 'Bağlantı yok'."""
    body = _raw_call("GET", "/api/v1/connection")
    if body.get("connected"):
        return {"connected": True, "message": "Bağlandı", "checks": (body.get("data") or {}).get("checks", {})}
    return {"connected": False, "message": body.get("message", "Bağlantı yok")}


def send_sms(recipients: list[str], message: str, callback_url: str | None = CALLBACK_URL,
             schedule_at: str | None = None, idempotency_key: str | None = None) -> dict:
    payload = {"recipients": recipients, "message": message}
    if callback_url:
        payload["callback_url"] = callback_url
    if schedule_at:
        payload["schedule_at"] = schedule_at
    return _call("POST", "/api/v1/sms/send", payload, idempotency_key)


def get_balance() -> dict:
    return _call("GET", "/api/v1/balance")


def get_message(message_id: str) -> dict:
    return _call("GET", f"/api/v1/sms/{message_id}")


if __name__ == "__main__":
    to = sys.argv[1] if len(sys.argv) > 1 else "905300000000"
    msg = sys.argv[2] if len(sys.argv) > 2 else "Merhaba WOLTSMS!"

    k = check_connection()
    if not k["connected"]:
        sys.exit(k["message"])  # ör. "Bağlantı yok: Geçersiz API anahtarı."
    c = k["checks"]
    print(f"Bağlandı (key_encrypted: {'var' if c.get('key_encrypted') else 'yok'}, "
          f"hmac_secret_encrypted: {'var' if c.get('hmac_secret_encrypted') else 'yok'})")
    try:
        o = send_sms([to], msg)
        print(f"Sipariş: {o['order_id']} | Segment: {o['segments']} | Maliyet: {o['total_cost']}")
    except WoltsmsError as e:
        print(f"Hata ({e.code}): {e.message}")
