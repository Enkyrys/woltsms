"use client";
import { useState } from "react";
import { PageTitle, Card, CopyBtn } from "@/components/ui";

const CURL = `curl -X POST https://panel.woltsms.com/api/v1/sms/send \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: wolt_xxx" \\
  -H "X-Timestamp: 1730000000" \\
  -H "X-Signature: <hmac_sha256(sha256(secret), timestamp.body)>" \\
  -H "Idempotency-Key: benzersiz-key-123" \\
  -d '{"recipients":["905300000000"],"message":"Merhaba WOLTSMS!"}'`;

const PHP = `<?php
$apiKey = 'wolt_xxx';
$secretHash = hash('sha256', 'SECRETINIZ'); // secret hash
$body = json_encode(['recipients' => ['905300000000'], 'message' => 'Merhaba WOLTSMS!']);
$ts = (string) time();
$sig = hash_hmac('sha256', $ts . '.' . $body, $secretHash);
$ch = curl_init('https://panel.woltsms.com/api/v1/sms/send');
curl_setopt_array($ch, [
  CURLOPT_POST => true, CURLOPT_RETURNTRANSFER => true,
  CURLOPT_HTTPHEADER => [
    'Content-Type: application/json', "X-API-Key: $apiKey",
    "X-Timestamp: $ts", "X-Signature: $sig",
  ],
  CURLOPT_POSTFIELDS => $body,
]);
echo curl_exec($ch);`;

const NODE = `const crypto = require('crypto');
const apiKey = 'wolt_xxx';
const secretHash = crypto.createHash('sha256').update('SECRETINIZ').digest('hex');
const body = JSON.stringify({ recipients: ['905300000000'], message: 'Merhaba WOLTSMS!' });
const ts = String(Math.floor(Date.now()/1000));
const sig = crypto.createHmac('sha256', secretHash).update(ts + '.' + body).digest('hex');
const res = await fetch('https://panel.woltsms.com/api/v1/sms/send', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'X-API-Key': apiKey, 'X-Timestamp': ts, 'X-Signature': sig },
  body
});
console.log(await res.json());`;

const PYTHON = `import hashlib, hmac, time, json, requests
api_key = 'wolt_xxx'
secret_hash = hashlib.sha256('SECRETINIZ'.encode()).hexdigest()
body = json.dumps({'recipients': ['905300000000'], 'message': 'Merhaba WOLTSMS!'})
ts = str(int(time.time()))
sig = hmac.new(secret_hash.encode(), f'{ts}.{body}'.encode(), hashlib.sha256).hexdigest()
r = requests.post('https://panel.woltsms.com/api/v1/sms/send',
  headers={'Content-Type': 'application/json', 'X-API-Key': api_key, 'X-Timestamp': ts, 'X-Signature': sig},
  data=body)
print(r.json())`;

export default function ApiDocsPage() {
  const [tab, setTab] = useState<"curl" | "php" | "node" | "python">("curl");
  const code = tab === "curl" ? CURL : tab === "php" ? PHP : tab === "node" ? NODE : PYTHON;
  return (
    <div>
      <PageTitle>WOLTSMS API Dokümantasyonu</PageTitle>
      <Card className="mb-4">
        <div className="flex gap-2 flex-wrap items-center">
          <b className="text-sm">OpenAPI:</b>
          <a href="/api/openapi.json" target="_blank" className="text-[#0FB5A0] font-mono text-sm">/api/openapi.json</a>
          <CopyBtn text="/api/openapi.json" />
        </div>
        <div className="text-[13px] mt-2 space-y-1">
          <div><span className="font-mono bg-green-100 px-1 rounded">POST</span> <span className="font-mono">/api/v1/sms/send</span> — {"{recipients[], message, schedule_at?, callback_url?}"}</div>
          <div><span className="font-mono bg-green-100 px-1 rounded">POST</span> <span className="font-mono">/api/v1/sms/bulk</span> — {"{messages:[{to, text}]}"}</div>
          <div><span className="font-mono bg-blue-100 px-1 rounded">GET</span> <span className="font-mono">/api/v1/sms/{"{id}"}</span> — mesaj durumu</div>
          <div><span className="font-mono bg-blue-100 px-1 rounded">GET</span> <span className="font-mono">/api/v1/orders</span> — sipariş listesi</div>
          <div><span className="font-mono bg-blue-100 px-1 rounded">GET</span> <span className="font-mono">/api/v1/balance</span> — kalan kredi</div>
        </div>
        <div className="text-[13px] mt-3">Yanıt: <span className="font-mono">{"{success, code, message, data}"}</span> · Kodlar: 200, 400, 401, 402 (yetersiz bakiye), 403, 422, 429, 500</div>
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
