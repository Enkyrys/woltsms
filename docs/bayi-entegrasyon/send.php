<?php
/**
 * WOLTSMS — PHP entegrasyonu (PHP 8+, cURL)
 * Kullanım: php send.php 905300000000 "Merhaba WOLTSMS!"
 * API anahtarını ortam değişkeninden veya aşağıdaki sabitten alır.
 */

const BASE_URL     = 'https://woltsms.vercel.app';
const CALLBACK_URL = 'https://woltsms.vercel.app/sms-callback'; // teslim raporlarının geleceği adres (isteğe bağlı)

function woltApiKey(): string
{
    // Panelde ÜRETİLİRKEN bir kez gösterilen TAM anahtar (wsk_live_290e1bb... ile başlar)
    $key = getenv('WOLTSMS_API_KEY') ?: 'wsk_live_290e1bb_TAM_ANAHTARI_BURAYA_YAZIN';
    if (str_contains($key, 'TAM_ANAHTARI')) {
        fwrite(STDERR, "Tam API anahtarını WOLTSMS_API_KEY olarak tanımlayın.\n");
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
        $headers[] = 'Content-Type: application/json';
        $headers[] = 'Idempotency-Key: ' . ($idempotencyKey ?? uniqid('order-', true));
        $opts[CURLOPT_POSTFIELDS] = json_encode($json, JSON_UNESCAPED_UNICODE);
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

function woltSmsGonder(array $alicilar, string $mesaj, ?string $callbackUrl = CALLBACK_URL, ?string $idempotencyKey = null): array
{
    $payload = ['recipients' => $alicilar, 'message' => $mesaj];
    if ($callbackUrl) {
        $payload['callback_url'] = $callbackUrl;
    }
    return woltRequest('POST', '/api/v1/sms/send', $payload, $idempotencyKey);
}

function woltBakiye(): array              { return woltRequest('GET', '/api/v1/balance'); }
function woltMesajDurumu(string $id): array { return woltRequest('GET', '/api/v1/sms/' . rawurlencode($id)); }

// ---- Kullanım ----
if (PHP_SAPI === 'cli' && realpath($_SERVER['SCRIPT_FILENAME'] ?? '') === __FILE__) {
    $to  = $argv[1] ?? '905300000000';
    $msg = $argv[2] ?? 'Merhaba WOLTSMS!';

    print_r(woltBakiye());
    $r = woltSmsGonder([$to], $msg);

    if (!empty($r['success'])) {
        echo "Sipariş: {$r['data']['order_id']} | Segment: {$r['data']['segments']} | Maliyet: {$r['data']['total_cost']}\n";
    } else {
        // 401 anahtar hatalı · 402 yetersiz bakiye · 403 IP yetkisiz · 422 doğrulama · 429 istek limiti
        echo "Hata ({$r['code']}): {$r['message']}\n";
    }
}
