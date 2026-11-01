"""WOLTSMS — Python entegrasyon örneği
Gerekli: requests (pip install requests)
"""

import uuid
import requests

API_KEY = "wsk_live_..."  # panelde ürettiğiniz anahtar
BASE_URL = "https://woltsms.com"


class WoltsmsError(Exception):
    def __init__(self, code: int, message: str):
        super().__init__(message)
        self.code = code  # 402 yetersiz bakiye, 422 doğrulama, 429 rate limit
        self.message = message


def send_sms(recipients: list[str], message: str, schedule_at: str | None = None,
             idempotency_key: str | None = None) -> dict:
    """SMS gönderir. Aynı idempotency_key ile tekrarlanan istek tekrar göndermez."""
    res = requests.post(
        f"{BASE_URL}/api/v1/sms/send",
        headers={
            "Content-Type": "application/json",
            "Authorization": f"Bearer {API_KEY}",
            "Idempotency-Key": idempotency_key or str(uuid.uuid4()),
        },
        json={
            "recipients": recipients,
            "message": message,
            "schedule_at": schedule_at,  # ISO 8601; 10:00–22:00 dışına kaydırılır
        },
        timeout=30,
    )
    data = res.json()
    if not data.get("success"):
        raise WoltsmsError(data.get("code", res.status_code), data.get("message", "Bilinmeyen hata"))
    return data["data"]


def get_balance() -> dict:
    res = requests.get(
        f"{BASE_URL}/api/v1/balance",
        headers={"Authorization": f"Bearer {API_KEY}"},
        timeout=15,
    )
    return res.json()["data"]  # {balance, reserved, available, unit_price, currency}


def get_message(message_id: str) -> dict:
    res = requests.get(
        f"{BASE_URL}/api/v1/sms/{message_id}",
        headers={"Authorization": f"Bearer {API_KEY}"},
        timeout=15,
    )
    return res.json()["data"]


if __name__ == "__main__":
    try:
        order = send_sms(["905XXXXXXXXX"], "Merhaba, kampanyamız başladı!")
        print(f"Sipariş: {order['order_id']} | Maliyet: {order['total_cost']} TL")
    except WoltsmsError as e:
        if e.code == 402:
            print("Yetersiz bakiye — lütfen kredi yükleyin.")
        else:
            print(f"Hata ({e.code}): {e.message}")
