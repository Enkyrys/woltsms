"""WOLTSMS — Teslim raporu (callback) alıcısı, Python (bağımlılık yok)
Çalıştır: python callback_server.py  → http://sunucunuz:3000/sms-callback
2xx dönmezseniz WOLTSMS isteği 5 kez tekrar dener.
"""
import json
from http.server import BaseHTTPRequestHandler, HTTPServer


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if not self.path.startswith("/sms-callback"):
            self.send_response(404); self.end_headers(); return
        raw = self.rfile.read(int(self.headers.get("Content-Length", 0)))
        try:
            d = json.loads(raw)
            # d["event"]: message.sent | message.delivered | message.failed
            print(d.get("event"), d.get("recipient"), d.get("status"), d.get("error", ""))
            # TODO: kendi veritabanınızı güncelleyin
            self.send_response(200); self.end_headers(); self.wfile.write(b"ok")
        except ValueError:
            self.send_response(400); self.end_headers()


HTTPServer(("0.0.0.0", 3000), Handler).serve_forever()
