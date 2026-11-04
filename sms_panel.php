<?php
/**
 * WOLTSMS — Yerel SMS Gönderim Paneli (tek dosya, PHP 8+, cURL eklentisi gerekir)
 *
 * Çalıştır (bu dosyanın bulunduğu klasörde):
 *   WOLTSMS_API_KEY="wsk_live_...TAM_ANAHTAR" php -S 127.0.0.1:8080 sms_panel.php
 * Sonra tarayıcıda: http://127.0.0.1:8080
 *
 * İsteğe bağlı: WOLTSMS_API_SECRET="wss_..."  → istekler X-Signature ile imzalanır.
 * Anahtarı ortam değişkeni yerine panelden de girebilirsiniz (PHP oturumunda tutulur).
 *
 * Özellikler: bağlantı kontrolü, bakiye, toplu gönderim (en fazla 5000 alıcı), zamanlama,
 * karakter/segment sayacı, gönderim geçmişi (sms_history.json), sipariş durum sorgusu,
 * teslim raporu (callback) alıcısı: POST /sms-callback  (callbacks.jsonl)
 */

if (PHP_SAPI !== 'cli-server') {
    fwrite(STDERR, "Kullanım: WOLTSMS_API_KEY=\"wsk_live_...\" php -S 127.0.0.1:8080 " . basename(__FILE__) . "\n");
    exit(1);
}

const BASE_URL_DEFAULT = 'https://woltsms.vercel.app';
const MAX_RECIPIENTS   = 5000;
const MAX_CHARS        = 918;
const HISTORY_FILE     = __DIR__ . '/sms_history.json';
const CALLBACK_FILE    = __DIR__ . '/callbacks.jsonl';

$BASE_URL = rtrim(getenv('WOLTSMS_BASE_URL') ?: BASE_URL_DEFAULT, '/');
$path     = parse_url($_SERVER['REQUEST_URI'] ?? '/', PHP_URL_PATH) ?: '/';
$method   = $_SERVER['REQUEST_METHOD'] ?? 'GET';

// ------------------------------------------------------------ yardımcılar
function out(int $code, $data, string $ctype = 'application/json; charset=utf-8'): never
{
    http_response_code($code);
    header('Content-Type: ' . $ctype);
    header('Cache-Control: no-store');
    echo is_string($data) ? $data : json_encode($data, JSON_UNESCAPED_UNICODE | JSON_INVALID_UTF8_SUBSTITUTE);
    exit;
}

function body(): array
{
    $raw = file_get_contents('php://input');
    if ($raw === false || strlen($raw) > 5_000_000) {
        return [];
    }
    $d = json_decode($raw, true);
    return is_array($d) ? $d : [];
}

function ulen(string $s): int
{
    return (int) preg_match_all('/./us', $s);
}

function readJsonFile(string $file): array
{
    $d = is_file($file) ? json_decode((string) file_get_contents($file), true) : null;
    return is_array($d) ? $d : [];
}

function addHistory(array $entry): void
{
    $fp = fopen(HISTORY_FILE, 'c+');
    if (!$fp) {
        return;
    }
    flock($fp, LOCK_EX);
    $h = json_decode((string) stream_get_contents($fp), true);
    $h = is_array($h) ? $h : [];
    array_unshift($h, $entry);
    ftruncate($fp, 0);
    rewind($fp);
    fwrite($fp, json_encode(array_slice($h, 0, 500), JSON_UNESCAPED_UNICODE | JSON_PRETTY_PRINT));
    flock($fp, LOCK_UN);
    fclose($fp);
}

function normalizePhone(string $raw): ?string
{
    $d = preg_replace('/\D/', '', $raw);
    if (str_starts_with($d, '00')) {
        $d = substr($d, 2);
    }
    if (strlen($d) === 11 && $d[0] === '0') {
        $d = '9' . $d;            // 05301234567 → 905301234567
    } elseif (strlen($d) === 10 && $d[0] === '5') {
        $d = '90' . $d;           // 5301234567  → 905301234567
    }
    return preg_match('/^905\d{9}$/', $d) ? $d : null;
}

/** @return array{0: string[], 1: string[]} [geçerli, geçersiz] */
function parseRecipients(string $text): array
{
    $ok = [];
    $bad = [];
    foreach (preg_split('/[\s,;]+/', trim($text), -1, PREG_SPLIT_NO_EMPTY) as $part) {
        $n = normalizePhone($part);
        if ($n === null) {
            $bad[] = $part;
        } else {
            $ok[$n] = true;       // anahtar olarak tekrarları eler
        }
    }
    return [array_map('strval', array_keys($ok)), $bad];
}

function apiCall(string $method, string $path, ?array $json = null): array
{
    global $BASE_URL, $KEY, $SECRET;
    if (!preg_match('/^wsk_live_[0-9a-f]{48}$/', $KEY)) {
        return ['success' => false, 'code' => 401, 'http_status' => 401,
            'message' => 'API anahtarı tanımlı değil ya da tam anahtar değil (wsk_live_ + 48 karakter).'];
    }
    $headers = ['Authorization: Bearer ' . $KEY, 'Accept: application/json'];
    $opts = [
        CURLOPT_URL            => $BASE_URL . $path,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CUSTOMREQUEST  => $method,
    ];
    if ($json !== null) {
        $raw = json_encode($json, JSON_UNESCAPED_UNICODE);
        $headers[] = 'Content-Type: application/json';
        $headers[] = 'Idempotency-Key: ' . bin2hex(random_bytes(16));
        if ($SECRET !== '') {
            $headers[] = 'X-Signature: ' . hash_hmac('sha256', $raw, $SECRET);
        }
        $opts[CURLOPT_POSTFIELDS] = $raw;
    }
    $opts[CURLOPT_HTTPHEADER] = $headers;

    $ch = curl_init();
    curl_setopt_array($ch, $opts);
    $res    = curl_exec($ch);
    $status = (int) curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);

    if ($res === false) {
        return ['success' => false, 'code' => 0, 'http_status' => 0, 'message' => 'Sunucuya ulaşılamadı: ' . $err];
    }
    $b = json_decode($res, true);
    if (!is_array($b)) {
        $b = ['success' => false, 'code' => $status, 'message' => 'Geçersiz yanıt'];
    }
    $b['http_status'] = $status;
    return $b;
}

function errorText(array $r): string
{
    static $names = [401 => 'Hatalı API anahtarı', 402 => 'Yetersiz bakiye', 403 => 'IP yetkisiz',
        422 => 'Doğrulama hatası', 429 => 'Dakikalık istek limiti aşıldı'];
    $code = $r['code'] ?? $r['http_status'] ?? 0;
    return trim(($names[$code] ?? 'Hata') . " ($code): " . ($r['message'] ?? ''));
}

// ------------------------------------------------------------ teslim raporu alıcısı (oturumsuz)
if (str_starts_with($path, '/sms-callback')) {
    if ($method !== 'POST') {
        out(405, 'method not allowed', 'text/plain');
    }
    $d = body();
    if (empty($d['event'])) {
        out(400, 'invalid', 'text/plain');
    }
    $d['_received'] = date('Y-m-d H:i:s');
    file_put_contents(CALLBACK_FILE, json_encode($d, JSON_UNESCAPED_UNICODE) . PHP_EOL, FILE_APPEND | LOCK_EX);
    out(200, 'ok', 'text/plain');   // 2xx dönmezseniz WOLTSMS 5 kez tekrar dener
}

// ------------------------------------------------------------ oturum / güvenlik
session_set_cookie_params(['httponly' => true, 'samesite' => 'Strict']);
session_start();
if (empty($_SESSION['token'])) {
    $_SESSION['token'] = bin2hex(random_bytes(24));
}
$TOKEN  = $_SESSION['token'];
$KEY    = $_SESSION['key'] ?? (getenv('WOLTSMS_API_KEY') ?: '');
$SECRET = $_SESSION['secret'] ?? (getenv('WOLTSMS_API_SECRET') ?: '');

if ($path === '/') {
    session_write_close();
    out(200, str_replace('__TOKEN__', $TOKEN, PAGE()), 'text/html; charset=utf-8');
}

if (!str_starts_with($path, '/api/')) {
    out(404, ['success' => false, 'message' => 'Bulunamadı']);
}

$host = preg_replace('/:\d+$/', '', $_SERVER['HTTP_HOST'] ?? '');
if (!in_array($host, ['127.0.0.1', 'localhost', '[::1]'], true) && !getenv('SMS_PANEL_ALLOW_REMOTE')) {
    out(403, ['success' => false, 'message' => 'Host reddedildi']);
}
if (!hash_equals($TOKEN, $_SERVER['HTTP_X_PANEL_TOKEN'] ?? '')) {
    out(403, ['success' => false, 'message' => 'Geçersiz panel oturumu, sayfayı yenileyin']);
}
if ($path !== '/api/key') {
    session_write_close();   // oturum kilidini erken bırak
}

// ------------------------------------------------------------ API uçları
switch ($path) {
    case '/api/status':
        $conn = apiCall('GET', '/api/v1/connection');
        $connected = !empty($conn['connected']);
        $balance = null;
        if ($connected) {
            $b = apiCall('GET', '/api/v1/balance');
            $balance = !empty($b['success']) ? ($b['data'] ?? null) : null;
        }
        out(200, [
            'has_key'   => $KEY !== '',
            'signed'    => $SECRET !== '',
            'connected' => $connected,
            'message'   => $connected ? 'Bağlandı' : ($conn['message'] ?? 'Bağlantı yok'),
            'balance'   => $balance,
        ]);

    case '/api/history':
        out(200, readJsonFile(HISTORY_FILE));

    case '/api/callbacks':
        $lines = is_file(CALLBACK_FILE) ? file(CALLBACK_FILE, FILE_IGNORE_NEW_LINES | FILE_SKIP_EMPTY_LINES) : [];
        $items = [];
        foreach (array_slice(array_reverse($lines), 0, 50) as $l) {
            $j = json_decode($l, true);
            if (is_array($j)) {
                $items[] = $j;
            }
        }
        out(200, $items);

    case '/api/message':
        $id = trim((string) ($_GET['id'] ?? ''));
        if (!preg_match('/^[\w\-]{1,80}$/', $id)) {
            out(422, ['success' => false, 'message' => 'Geçersiz sipariş numarası']);
        }
        $r = apiCall('GET', '/api/v1/sms/' . rawurlencode($id));
        $ok = !empty($r['success']);
        out($ok ? 200 : 400, ['success' => $ok, 'data' => $r['data'] ?? null, 'message' => $ok ? '' : errorText($r)]);

    case '/api/key':
        $d = body();
        $key = trim((string) ($d['key'] ?? ''));
        if (!preg_match('/^wsk_live_[0-9a-f]{48}$/', $key)) {
            out(422, ['success' => false,
                'message' => 'Tam anahtar gerekli: wsk_live_ + 48 karakter (kısa ön ek çalışmaz).']);
        }
        $_SESSION['key']    = $key;
        $_SESSION['secret'] = trim((string) ($d['secret'] ?? ''));
        out(200, ['success' => true]);

    case '/api/send':
        if ($method !== 'POST') {
            out(405, ['success' => false, 'message' => 'POST gerekli']);
        }
        $d = body();
        [$ok, $bad] = parseRecipients((string) ($d['recipients'] ?? ''));
        $msg = (string) ($d['message'] ?? '');
        if (!$ok) {
            out(422, ['success' => false, 'message' => 'Geçerli alıcı yok (905XXXXXXXXX).', 'invalid' => $bad]);
        }
        if (count($ok) > MAX_RECIPIENTS) {
            out(422, ['success' => false, 'message' => 'En fazla ' . MAX_RECIPIENTS . ' alıcı.']);
        }
        if (trim($msg) === '' || ulen($msg) > MAX_CHARS) {
            out(422, ['success' => false, 'message' => 'Mesaj 1–' . MAX_CHARS . ' karakter olmalı.']);
        }
        $payload = ['recipients' => $ok, 'message' => $msg];
        $cb = trim((string) ($d['callback_url'] ?? ''));
        if ($cb !== '' && preg_match('#^https?://#i', $cb) && filter_var($cb, FILTER_VALIDATE_URL)) {
            $payload['callback_url'] = $cb;
        }
        if (!empty($d['schedule_at'])) {
            $payload['schedule_at'] = (string) $d['schedule_at'];
        }
        $r = apiCall('POST', '/api/v1/sms/send', $payload);
        $entry = [
            'time' => date('Y-m-d H:i:s'), 'count' => count($ok), 'to' => array_slice($ok, 0, 3),
            'message' => $msg, 'scheduled' => $payload['schedule_at'] ?? '',
        ];
        if (!empty($r['success'])) {
            $o = $r['data'] ?? [];
            $entry += ['order_id' => $o['order_id'] ?? '', 'segments' => $o['segments'] ?? null,
                'cost' => $o['total_cost'] ?? null, 'result' => 'gönderildi'];
            addHistory($entry);
            out(200, ['success' => true, 'data' => $o, 'invalid' => $bad]);
        }
        $entry += ['result' => 'hata', 'error' => errorText($r)];
        addHistory($entry);
        out(400, ['success' => false, 'message' => errorText($r), 'invalid' => $bad]);

    default:
        out(404, ['success' => false, 'message' => 'Bulunamadı']);
}

// ------------------------------------------------------------ arayüz
function PAGE(): string
{
    return <<<'HTML'
<!doctype html>
<html lang="tr"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>WOLTSMS Panel</title>
<style>
:root{--bg:#f5f6f8;--card:#fff;--tx:#1b1f24;--mut:#6a7380;--bd:#dde1e7;--ac:#2563eb;--ok:#15803d;--er:#b91c1c}
@media(prefers-color-scheme:dark){:root{--bg:#0f1318;--card:#171c23;--tx:#e6e9ee;--mut:#8b95a3;--bd:#2a313b;--ac:#4f8cff;--ok:#4ade80;--er:#f87171}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--tx);font:14px/1.5 system-ui,Segoe UI,sans-serif}
header{display:flex;gap:16px;align-items:center;flex-wrap:wrap;padding:14px 20px;background:var(--card);border-bottom:1px solid var(--bd)}
header h1{font-size:17px;margin:0;margin-right:auto}
.badge{padding:3px 10px;border-radius:99px;font-size:12px;border:1px solid var(--bd)}
.on{color:var(--ok);border-color:var(--ok)}.off{color:var(--er);border-color:var(--er)}
main{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px;padding:16px 20px;max-width:1200px;margin:auto}
@media(max-width:860px){main{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--bd);border-radius:10px;padding:16px}
.card h2{font-size:14px;margin:0 0 12px}.full{grid-column:1/-1}
label{display:block;font-size:12px;color:var(--mut);margin:10px 0 4px}
input,textarea,button{font:inherit;color:inherit}
input,textarea{width:100%;padding:8px 10px;border:1px solid var(--bd);border-radius:7px;background:transparent}
textarea{resize:vertical;min-height:90px}
button{padding:8px 16px;border:0;border-radius:7px;background:var(--ac);color:#fff;cursor:pointer}
button.sec{background:transparent;color:var(--tx);border:1px solid var(--bd)}button:disabled{opacity:.5;cursor:wait}
.row{display:flex;gap:10px;align-items:center;flex-wrap:wrap}.row>*{flex:1}.row>button{flex:0 0 auto}
.hint{font-size:12px;color:var(--mut);margin-top:4px}.msg{margin-top:10px;font-size:13px;white-space:pre-wrap}
.ok{color:var(--ok)}.er{color:var(--er)}
.tbl{overflow-x:auto}table{border-collapse:collapse;width:100%;font-size:12.5px}
th,td{text-align:left;padding:6px 8px;border-bottom:1px solid var(--bd);vertical-align:top}th{color:var(--mut);font-weight:500}
pre{margin:8px 0 0;padding:10px;border:1px solid var(--bd);border-radius:7px;overflow:auto;font-size:12px}
</style></head><body>
<header>
  <h1>WOLTSMS Panel</h1>
  <span id="conn" class="badge off">Kontrol ediliyor…</span>
  <span id="bal" class="badge">Bakiye: —</span>
  <button class="sec" onclick="refreshStatus()">Yenile</button>
</header>
<main>
  <section class="card" id="keycard" hidden>
    <h2>API Anahtarı</h2>
    <label>API Key (wsk_live_ + 48 karakter)</label><input id="k" autocomplete="off" placeholder="wsk_live_...">
    <label>API Secret (isteğe bağlı, imza için)</label><input id="s" autocomplete="off" placeholder="wss_...">
    <div class="row" style="margin-top:12px"><button onclick="saveKey()">Kaydet ve bağlan</button></div>
    <div id="kmsg" class="msg"></div>
    <div class="hint">Anahtar PHP oturumunda tutulur (sunucu tarafı, tarayıcıya geri gönderilmez).</div>
  </section>

  <section class="card" id="sendcard">
    <h2>SMS Gönder</h2>
    <label>Alıcılar (satır, boşluk veya virgülle ayırın)</label>
    <textarea id="to" placeholder="905301234567&#10;05301234568&#10;5301234569"></textarea>
    <div class="hint" id="toinfo">0 geçerli alıcı</div>
    <label>Mesaj</label>
    <textarea id="text" maxlength="918" placeholder="Mesajınız…"></textarea>
    <div class="hint" id="cnt">0 / 918 karakter</div>
    <div class="row">
      <div><label>Zamanlama (boş = hemen)</label><input id="sch" type="datetime-local"></div>
      <div><label>Callback URL (isteğe bağlı)</label><input id="cb" placeholder="https://.../sms-callback"></div>
    </div>
    <div class="row" style="margin-top:14px"><button id="sendbtn" onclick="send()">Gönder</button></div>
    <div id="smsg" class="msg"></div>
  </section>

  <section class="card">
    <h2>Sipariş Durumu Sorgula</h2>
    <div class="row"><input id="oid" placeholder="order_id"><button onclick="lookup()">Sorgula</button></div>
    <div id="omsg" class="msg"></div><pre id="oout" hidden></pre>
    <h2 style="margin-top:20px">Teslim Raporları (callback)</h2>
    <div class="hint">Bu panel <code>POST /sms-callback</code> adresinde rapor kabul eder. Dışarıdan erişim için bir tünel
    (ör. ngrok / cloudflared) gerekir; tünel adresini yukarıdaki Callback URL alanına yazın.</div>
    <div class="tbl"><table><thead><tr><th>Zaman</th><th>Olay</th><th>Alıcı</th><th>Durum</th></tr></thead>
    <tbody id="cbs"><tr><td colspan="4" class="hint">Henüz rapor yok</td></tr></tbody></table></div>
  </section>

  <section class="card full">
    <h2>Gönderim Geçmişi</h2>
    <div class="tbl"><table><thead><tr><th>Zaman</th><th>Alıcı</th><th>Mesaj</th><th>Segment</th><th>Maliyet</th><th>Sipariş</th><th>Sonuç</th></tr></thead>
    <tbody id="hist"></tbody></table></div>
  </section>
</main>
<script>
const T="__TOKEN__";
const $=id=>document.getElementById(id);
const esc=s=>String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]));
const GSM="@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿abcdefghijklmnopqrstuvwxyzäöñüà^{}\\[~]|€";
async function api(path,opt={}){
  const r=await fetch(path,{...opt,headers:{"X-Panel-Token":T,"Content-Type":"application/json"}});
  let j={};try{j=await r.json()}catch{}return j;
}
function norm(p){let d=p.replace(/\D/g,"");if(d.startsWith("00"))d=d.slice(2);
  if(d.length==11&&d[0]=="0")d="9"+d;else if(d.length==10&&d[0]=="5")d="90"+d;return /^905\d{9}$/.test(d)?d:null}
function parse(){const ok=new Set(),bad=[];for(const p of $("to").value.split(/[\s,;]+/).filter(Boolean)){const n=norm(p);n?ok.add(n):bad.push(p)}return{ok:[...ok],bad}}
$("to").addEventListener("input",()=>{const{ok,bad}=parse();
  $("toinfo").innerHTML=ok.length+" geçerli alıcı"+(bad.length?` · <span class="er">${bad.length} geçersiz</span>`:"")});
$("text").addEventListener("input",()=>{const t=$("text").value,chars=[...t],
  uni=chars.some(c=>!GSM.includes(c)),single=uni?70:160,multi=uni?67:153,n=chars.length,
  seg=n==0?0:(n<=single?1:Math.ceil(n/multi));
  $("cnt").textContent=`${n} / 918 karakter · ~${seg} segment (${uni?"Unicode":"GSM"}, tahmini)`});
async function refreshStatus(){
  const s=await api("/api/status");
  $("conn").textContent=s.connected?"Bağlandı":(s.message||"Bağlantı yok");
  $("conn").className="badge "+(s.connected?"on":"off");
  $("keycard").hidden=!!s.connected;
  $("bal").textContent="Bakiye: "+(s.balance?(s.balance.balance??s.balance.credit??JSON.stringify(s.balance)):"—");
}
async function saveKey(){
  const r=await api("/api/key",{method:"POST",body:JSON.stringify({key:$("k").value,secret:$("s").value})});
  $("kmsg").className="msg "+(r.success?"ok":"er");$("kmsg").textContent=r.success?"Kaydedildi":r.message;
  if(r.success){$("k").value="";$("s").value="";refreshStatus()}
}
async function send(){
  const{ok}=parse();if(!ok.length)return $("smsg").innerHTML='<span class="er">Geçerli alıcı yok</span>';
  if(!confirm(ok.length+" alıcıya SMS gönderilsin mi?"))return;
  $("sendbtn").disabled=true;$("smsg").textContent="Gönderiliyor…";
  const sch=$("sch").value;
  const r=await api("/api/send",{method:"POST",body:JSON.stringify({recipients:$("to").value,message:$("text").value,
    schedule_at:sch?sch+":00":"",callback_url:$("cb").value})});
  $("sendbtn").disabled=false;
  if(r.success){const o=r.data||{};$("smsg").className="msg ok";
    $("smsg").textContent=`Sipariş: ${o.order_id} | Segment: ${o.segments} | Maliyet: ${o.total_cost}`+(r.invalid?.length?`\n${r.invalid.length} geçersiz numara atlandı`:"");
    $("oid").value=o.order_id||"";refreshStatus();loadHistory()}
  else{$("smsg").className="msg er";$("smsg").textContent=r.message||"Hata";loadHistory()}
}
async function lookup(){
  const id=$("oid").value.trim();if(!id)return;
  const r=await api("/api/message?id="+encodeURIComponent(id));
  $("omsg").className="msg "+(r.success?"ok":"er");$("omsg").textContent=r.success?"":r.message;
  $("oout").hidden=!r.success;if(r.success)$("oout").textContent=JSON.stringify(r.data,null,2);
}
async function loadHistory(){
  const h=await api("/api/history");
  $("hist").innerHTML=(Array.isArray(h)?h:[]).slice(0,100).map(e=>`<tr><td>${esc(e.time)}</td>
  <td>${esc((e.to||[]).join(", "))}${e.count>3?` +${e.count-3}`:""}</td><td>${esc((e.message||"").slice(0,60))}</td>
  <td>${esc(e.segments)}</td><td>${esc(e.cost)}</td><td>${esc(e.order_id)}</td>
  <td class="${e.result=="hata"?"er":"ok"}">${esc(e.result=="hata"?e.error:e.result+(e.scheduled?" (zamanlı)":""))}</td></tr>`).join("")
  ||'<tr><td colspan="7" class="hint">Kayıt yok</td></tr>';
}
async function loadCallbacks(){
  const c=await api("/api/callbacks");if(!Array.isArray(c)||!c.length)return;
  $("cbs").innerHTML=c.map(d=>`<tr><td>${esc(d._received)}</td><td>${esc(d.event)}</td>
  <td>${esc(d.recipient)}</td><td>${esc(d.status)} ${esc(d.error||"")}</td></tr>`).join("");
}
refreshStatus();loadHistory();loadCallbacks();setInterval(loadCallbacks,5000);
</script></body></html>
HTML;
}
