"""WOLTSMS — Python entegrasyonu (pip install requests)
Kullanım: WOLTSMS_API_KEY="wsk_live_290e1bb...TAM_ANAHTAR" python send.py 905300000000 "Merhaba WOLTSMS!"
"""
import os
import sys
import uuid

import requests

BASE_URL = "https://woltsms.vercel.app"
CALLBACK_URL = "https://woltsms.vercel.app/sms-callback"  # isteğe bağlı: teslim raporu adresi
API_KEY = os.environ.get("WOLTSMS_API_KEY")

if not API_KEY:
    sys.exit("Tam API anahtarını WOLTSMS_API_KEY olarak tanımlayın (wsk_live_290e1bb... ile başlar).")


class WoltsmsError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code  # 401 anahtar · 402 bakiye · 403 IP · 422 doğrulama · 429 limit
        self.message = message


def _call(method: str, path: str, json: dict | None = None, idempotency_key: str | None = None) -> dict:
    headers = {"Authorization": f"Bearer {API_KEY}"}
    if json is not None:
        headers["Idempotency-Key"] = idempotency_key or str(uuid.uuid4())
    res = requests.request(method, BASE_URL + path, headers=headers, json=json, timeout=30)
    try:
        data = res.json()
    except ValueError:
        raise WoltsmsError(res.status_code, "Geçersiz yanıt")
    if not data.get("success"):
        raise WoltsmsError(data.get("code", res.status_code), data.get("message", "Bilinmeyen hata"))
    return data["data"]


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
    try:
        print("Bakiye:", get_balance())
        o = send_sms([to], msg)
        print(f"Sipariş: {o['order_id']} | Segment: {o['segments']} | Maliyet: {o['total_cost']}")
    except WoltsmsError as e:
        print(f"Hata ({e.code}): {e.message}")
