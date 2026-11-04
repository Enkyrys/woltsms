<?php
/**
 * WOLTSMS — Teslim raporu (callback) alıcısı
 * Bu dosyayı bayi sitenizde yayınlayın ve adresini callback_url olarak verin.
 * WOLTSMS buraya JSON POST eder:
 *   { "event": "message.sent|message.delivered|message.failed",
 *     "message_id": "...", "order_id": "...", "recipient": "905...",
 *     "status": "sent|delivered|failed", "error": "..." }
 * ÖNEMLİ: 2xx yanıt dönmezseniz istek 5 kez tekrar denenir (10 sn zaman aşımı).
 */
$raw  = file_get_contents('php://input');
$data = json_decode($raw, true);

if (!is_array($data) || empty($data['event'])) {
    http_response_code(400);
    exit('invalid');
}

// Kendi sisteminizde güncelleyin (veritabanı vb.). Örnek: dosyaya yaz.
file_put_contents(__DIR__ . '/callbacks.log', date('c') . ' ' . $raw . PHP_EOL, FILE_APPEND | LOCK_EX);

http_response_code(200);
echo 'ok';
