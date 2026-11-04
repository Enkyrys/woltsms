// WOLTSMS — Teslim raporu (callback) alıcısı, Node.js (bağımlılık yok)
// Çalıştır: node callback-server.mjs   → http://sunucunuz:3000/sms-callback
// 2xx dönmezseniz WOLTSMS isteği 5 kez tekrar dener.
import { createServer } from "node:http";

createServer((req, res) => {
  if (req.method !== "POST" || !req.url.startsWith("/sms-callback")) {
    res.writeHead(404).end();
    return;
  }
  let raw = "";
  req.on("data", (c) => (raw += c));
  req.on("end", () => {
    try {
      const d = JSON.parse(raw);
      // d.event: message.sent | message.delivered | message.failed
      console.log(new Date().toISOString(), d.event, d.recipient, d.status, d.error ?? "");
      // TODO: kendi veritabanınızı güncelleyin
      res.writeHead(200, { "Content-Type": "text/plain" }).end("ok");
    } catch {
      res.writeHead(400).end("invalid");
    }
  });
}).listen(process.env.PORT || 3000, () => console.log("Callback alıcısı hazır"));
