"use client";
import { useEffect, useState } from "react";
import { PageTitle, Card, CopyBtn } from "@/components/ui";

// Varsayılan canlı adres. Panel hangi alan adından açıldıysa (vercel.app veya özel domain)
// örnekler çalışma anında otomatik o adrese çevrilir.
const DEFAULT_BASE = "https://woltsms.vercel.app";

const curlCode = (base: string) => `curl -X POST ${base}/api/v1/sms/send \\
  -H "Content-Type: application/json" \\
  -H "Authorization: Bearer wsk_live_xxx" \\
  -H "Idempotency-Key: benzersiz-key-123" \\
  -d '{"recipients":["905300000000"],"message":"Merhaba WOLTSMS!"}'`;

const phpCode = (base: string) => `<?php
$apiKey  = 'wsk_live_xxx';          // panelde ürettiğiniz anahtar
$baseUrl = '${base}';

$body = json_encode([
  'recipients' => ['905300000000'],
  'message'    => 'Merhaba WOLTSMS!',
], JSON_UNESCAPED_UNICODE);

$ch = curl_init($baseUrl . '/api/v1/sms/send');
curl_setopt_array($ch, [
  CURLOPT_POST           => true,
  CURLOPT_RETURNTRANSFER => true,
  CURLOPT_TIMEOUT        => 30,
  CURLOPT_HTTPHEADER     => [
    'Content-Type: application/json',
    'Authorization: Bearer ' . $apiKey,
    'Idempotency-Key: ' . uniqid('order-', true),
  ],
  CURLOPT_POSTFIELDS     => $body,
]);
$res = curl_exec($ch);
$status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
curl_close($ch);

echo $status . ' ' . $res;`;

const nodeCode = (base: string) => `// Node.js 18+ (sunucu tarafında çalıştırın)
const API_KEY = 'wsk_live_xxx';
const BASE_URL = '${base}';

const res = await fetch(BASE_URL + '/api/v1/sms/send', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': 'Bearer ' + API_KEY,
    'Idempotency-Key': crypto.randomUUID(),
  },
  body: JSON.stringify({
    recipients: ['905300000000'],
    message: 'Merhaba WOLTSMS!',
  }),
});
console.log(res.status, await res.json());`;

const pythonCode = (base: string) => `import uuid
import requests

API_KEY = "wsk_live_xxx"
BASE_URL = "${base}"

r = requests.post(
    f"{BASE_URL}/api/v1/sms/send",
    headers={
        "Content-Type": "application/json",
        "Authorization": f"Bearer {API_KEY}",
        "Idempotency-Key": str(uuid.uuid4()),
    },
    json={"recipients": ["905300000000"], "message": "Merhaba WOLTSMS!"},
    timeout=30,
)
print(r.status_code, r.json())`;

type Tab = "curl" | "php" | "node" | "python";

export default function ApiDocsPage() {
  const [tab, setTab] = useState<Tab>("curl");
  const [base, setBase] = useState(DEFAULT_BASE);

  useEffect(() => {
    if (typeof window !== "undefined") setBase(window.location.origin);
  }, []);

  const code =
    tab === "curl" ? curlCode(base) : tab === "php" ? phpCode(base) : tab === "node" ? nodeCode(base) : pythonCode(base);

  return (
    <div>
      <PageTitle>WOLTSMS API Dokümantasyonu</PageTitle>

      <Card className="mb-4">
        <div className="text-[13px] space-y-1">
          <div className="flex gap-2 flex-wrap items-center">
            <b>Base URL:</b>
            <span className="font-mono">{base}</span>
            <CopyBtn text={base} />
          </div>
          <div>
            <b>Kimlik doğrulama:</b>{" "}
            <span className="font-mono">Authorization: Bearer wsk_live_...</span> (API anahtarını panelde{" "}
            <b>API Anahtarları</b> bölümünden üretin; yalnızca bir kez gösterilir)
          </div>
          <div>
            <b>Güvenlik:</b> API anahtarını yalnızca kendi <b>sunucunuzda</b> kullanın; tarayıcıdaki JavaScript&apos;e
            veya mobil uygulamaya koymayın. İsterseniz anahtara IP beyaz listesi tanımlayabilirsiniz.
          </div>
          <div>
            <b>Çift gönderim koruması:</b> <span className="font-mono">Idempotency-Key</span> header&apos;ı gönderin;
            aynı anahtarla tekrar edilen istek yeniden gönderim yapmaz.
          </div>
        </div>
      </Card>

      <Card className="mb-4">
        <div className="flex gap-2 flex-wrap items-center">
          <b className="text-sm">OpenAPI:</b>
          <a href="/api/openapi.json" target="_blank" className="text-[#0FB5A0] font-mono text-sm">/api/openapi.json</a>
          <CopyBtn text={`${base}/api/openapi.json`} />
        </div>
        <div className="text-[13px] mt-2 space-y-1">
          <div><span className="font-mono bg-green-100 px-1 rounded">POST</span> <span className="font-mono">/api/v1/sms/send</span> — {"{recipients[], message, schedule_at?, callback_url?}"}</div>
          <div><span className="font-mono bg-green-100 px-1 rounded">POST</span> <span className="font-mono">/api/v1/sms/bulk</span> — {"{messages:[{to, text}]}"}</div>
          <div><span className="font-mono bg-blue-100 px-1 rounded">GET</span> <span className="font-mono">/api/v1/sms/{"{id}"}</span> — mesaj durumu</div>
          <div><span className="font-mono bg-blue-100 px-1 rounded">GET</span> <span className="font-mono">/api/v1/orders</span> — sipariş listesi</div>
          <div><span className="font-mono bg-blue-100 px-1 rounded">GET</span> <span className="font-mono">/api/v1/balance</span> — kalan kredi</div>
        </div>
        <div className="text-[13px] mt-3">
          Yanıt: <span className="font-mono">{"{success, code, message, data}"}</span> · Kodlar: 202 (kuyruğa alındı), 400, 401 (hatalı anahtar), 402 (yetersiz bakiye), 403 (IP yetkisiz), 422 (doğrulama), 429 (istek limiti), 500
        </div>
        <div className="text-[13px] mt-2">
          Alıcı formatı: <span className="font-mono">905XXXXXXXXX</span> · Mesaj en fazla 918 karakter · Tek istekte en fazla 5000 alıcı
        </div>
      </Card>

      <Card>
        <div className="flex gap-2 mb-3">
          {(["curl", "php", "node", "python"] as const).map((t) => (
            <button key={t} onClick={() => setTab(t)} className={`px-4 py-2 rounded-lg text-sm font-bold ${tab === t ? "tab-active" : "bg-slate-100"}`}>{t === "node" ? "Node.js" : t.toUpperCase()}</button>
          ))}
          <span className="ml-auto"><CopyBtn text={code} /></span>
        </div>
        <pre className="bg-slate-900 text-green-200 text-[12px] p-4 rounded-lg overflow-auto whitespace-pre-wrap">{code}</pre>
      </Card>
    </div>
  );
}
