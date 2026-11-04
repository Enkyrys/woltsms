<?php
/**
 * WOLTSMS — PHP entegrasyonu (PHP 8+, cURL)
 * Kullanım: php send.php 905300000000 "Merhaba WOLTSMS!"
 *
 * Ortam değişkenleri:
 *   WOLTSMS_API_KEY     (zorunlu)  panelde üretilen TAM anahtar (wsk_live_ + 48 karakter)
 *   WOLTSMS_API_SECRET  (opsiyonel) varsa istekler X-Signature ile imzalanır
 */

const BASE_URL     = 'https://woltsms.vercel.app';
const CALLBACK_URL = 'https://woltsms.vercel.app/sms-callback'; // teslim raporu adresi (isteğe bağlı)

function woltApiKey(): string
{
    $key = getenv('WOLTSMS_API_KEY') ?: '';
    // 57 karakter: "wsk_live_" + 48 hex. Kısa ön ek (ör. wsk_live_b8ae809) ÇALIŞMAZ.
    if (!preg_match('/^wsk_live_[0-9a-f]{48}$/', $key)) {
        fwrite(STDERR, "Bağlantı yok: WOLTSMS_API_KEY tam anahtar değil (wsk_live_ + 48 karakter olmalı).\n");
        exit(1);
    }
    return $key;
}

function woltRequest(string $method, string $path, ?array $json = null, ?string $idempotencyKey = null): array
{
    $headers = ['Authorization: Bearer ' . woltApiKey()];
    $opts = [
        CURLOPT_URL            => BASE_URL . $path,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT        => 30,
        CURLOPT_CUSTOMREQUEST  => $method,
    ];
    if ($json !== null) {
        $raw = json_encode($json, JSON_UNESCAPED_UNICODE);
        $headers[] = 'Content-Type: application/json';
        $headers[] = 'Idempotency-Key: ' . ($idempotencyKey ?? uniqid('order-', true));
        if ($secret = getenv('WOLTSMS_API_SECRET')) {
            $headers[] = 'X-Signature: ' . hash_hmac('sha256', $raw, $secret);
        }
        $opts[CURLOPT_POSTFIELDS] = $raw;
    }
    $opts[CURLOPT_HTTPHEADER] = $headers;

    $ch = curl_init();
    curl_setopt_array($ch, $opts);
    $res    = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $err    = curl_error($ch);
    curl_close($ch);

    if ($res === false) {
        return ['success' => false, 'code' => 0, 'message' => 'Bağlantı hatası: ' . $err, 'http_status' => 0];
    }
    $body = json_decode($res, true) ?: ['success' => false, 'message' => 'Geçersiz yanıt: ' . $res];
    $body['http_status'] = $status;
    return $body;
}

/**
 * Bağlantı kontrolü: api_keys tablosunda anahtar (user_id, key_encrypted, hmac_secret_encrypted) kaydı
 * varsa "Bağlandı", yoksa "Bağlantı yok" döner.
 */
function woltBaglantiKontrol(): array
{
    $r = woltRequest('GET', '/api/v1/connection');
    if (!empty($r['connected'])) {
        $c = $r['data']['checks'] ?? [];
        return [
            'connected' => true,
            'message'   => 'Bağlandı',
            'checks'    => $c,
        ];
    }
    return ['connected' => false, 'message' => $r['message'] ?? 'Bağlantı yok'];
}

function woltSmsGonder(array $alicilar, string $mesaj, ?string $callbackUrl = CALLBACK_URL, ?string $idempotencyKey = null): array
{
    $payload = ['recipients' => $alicilar, 'message' => $mesaj];
    if ($callbackUrl) {
        $payload['callback_url'] = $callbackUrl;
    }
    return woltRequest('POST', '/api/v1/sms/send', $payload, $idempotencyKey);
}

function woltBakiye(): array                { return woltRequest('GET', '/api/v1/balance'); }
function woltMesajDurumu(string $id): array { return woltRequest('GET', '/api/v1/sms/' . rawurlencode($id)); }

// ---- Kullanım ----
if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    $to  = $argv[1] ?? '905300000000';
    $msg = $argv[2] ?? 'Merhaba WOLTSMS!';

    $k = woltBaglantiKontrol();
    if (!$k['connected']) {
        echo $k['message'] . "\n";   // ör. "Bağlantı yok: Geçersiz API anahtarı."
        exit(1);
    }
    echo "Bağlandı";
    echo " (key_encrypted: " . (!empty($k['checks']['key_encrypted']) ? 'var' : 'yok')
       . ", hmac_secret_encrypted: " . (!empty($k['checks']['hmac_secret_encrypted']) ? 'var' : 'yok') . ")\n";

    $r = woltSmsGonder([$to], $msg);
    if (!empty($r['success'])) {
        echo "Sipariş: {$r['data']['order_id']} | Segment: {$r['data']['segments']} | Maliyet: {$r['data']['total_cost']}\n";
    } else {
        // 401 anahtar hatalı · 402 yetersiz bakiye · 403 IP yetkisiz · 422 doğrulama · 429 istek limiti
        echo "Hata ({$r['code']}): {$r['message']}\n";
    }
}
