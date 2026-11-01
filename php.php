<?php
/**
 * WOLTSMS — PHP entegrasyon örneği
 * Gerekli: PHP 8+ ve cURL.
 */

$apiKey   = 'wsk_live_...';            // panelde ürettiğiniz anahtar (bir kez gösterilir)
$baseUrl  = 'https://woltsms.com';

/**
 * SMS gönder
 */
function woltSmsGonder(string $apiKey, string $baseUrl, array $recipients, string $message, ?string $idempotencyKey = null): array
{
    $payload = json_encode([
        'recipients' => $recipients,
        'message'    => $message,
    ], JSON_UNESCAPED_UNICODE);

    $ch = curl_init($baseUrl . '/api/v1/sms/send');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_POST           => true,
        CURLOPT_POSTFIELDS     => $payload,
        CURLOPT_HTTPHEADER     => [
            'Content-Type: application/json',
            'Authorization: Bearer ' . $apiKey,
            // Aynı isteğin iki kez işlenmesini engeller:
            'Idempotency-Key: ' . ($idempotencyKey ?? uniqid('order-', true)),
        ],
        CURLOPT_TIMEOUT        => 30,
    ]);

    $res    = curl_exec($ch);
    $status = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    curl_close($ch);

    $body = json_decode($res, true) ?: ['success' => false, 'message' => 'Geçersiz yanıt'];
    $body['http_status'] = $status;
    return $body;
}

/**
 * Bakiye sorgula
 */
function woltSmsBakiye(string $apiKey, string $baseUrl): array
{
    $ch = curl_init($baseUrl . '/api/v1/balance');
    curl_setopt_array($ch, [
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_HTTPHEADER     => ['Authorization: Bearer ' . $apiKey],
        CURLOPT_TIMEOUT        => 15,
    ]);
    $res = curl_exec($ch);
    curl_close($ch);
    return json_decode($res, true) ?: [];
}

// ---- Kullanım ----
$result = woltSmsGonder($apiKey, $baseUrl, ['905XXXXXXXXX'], 'Merhaba, kampanyamız başladı!');

if ($result['success']) {
    echo "Sipariş: " . $result['data']['order_id'] .
         " | Toplam: " . $result['data']['total_count'] .
         " | Segment: " . $result['data']['segments'] .
         " | Maliyet: " . $result['data']['total_cost'] . " TL\n";
} else {
    // 402 = yetersiz bakiye, 422 = doğrulama, 429 = rate limit
    echo "Hata (" . $result['code'] . "): " . $result['message'] . "\n";
}
