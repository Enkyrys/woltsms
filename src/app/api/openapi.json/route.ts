import { NextResponse } from "next/server";

export const runtime = "nodejs";

// GET /api/openapi.json — public API şeması (docs/openapi.json ile aynı sözleşme)
export async function GET() {
  const spec = {
    openapi: "3.1.0",
    info: {
      title: "WOLTSMS API",
      version: "1.0.0",
      description:
        "WOLTSMS Bayi SMS Paneli - Public API. Auth: Authorization: Bearer <api_key> (opsiyonel X-Signature: sha256=HMAC-SHA256(body)). Tüm yanıtlar {success, code, message, data, meta?} zarfındadır.",
    },
    servers: [{ url: "/api/v1" }],
    security: [{ Bearer: [] }],
    components: {
      securitySchemes: {
        Bearer: { type: "http", scheme: "bearer", description: "Panelde üretilen wsk_live_... API anahtarı" },
      },
    },
    paths: {
      "/sms/send": {
        post: {
          summary: "SMS Gönder",
          parameters: [
            { name: "Idempotency-Key", in: "header", required: false, schema: { type: "string" }, description: "Aynı anahtarla tekrar gönderim aynı yanıtı döner" },
          ],
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    recipients: { type: "array", items: { type: "string" }, maxItems: 5000 },
                    message: { type: "string", maxLength: 918 },
                    schedule_at: { type: "string", format: "date-time", description: "İsteğe bağlı ileri tarih (ISO 8601, ör. 2026-11-05T14:30:00+03:00; saat dilimsiz değer Türkiye saati). Oluşturma saatinden sonra olmalı; o an gelince Sempico'ya gönderilir. Boşsa hemen gönderilir." },
                    callback_url: { type: "string", format: "uri", description: "DLR bildirimi için (API anahtarına kaydedilir)" },
                  },
                  required: ["recipients", "message"],
                },
              },
            },
          },
          responses: {
            "202": { description: "Kuyruğa alındı" },
            "400": { description: "Geçersiz istek" },
            "401": { description: "Geçersiz API anahtarı" },
            "402": { description: "Yetersiz bakiye" },
            "422": { description: "Geçerli alıcı yok / gönderim penceresi dışı / tümü karaliste" },
            "429": { description: "İstek limiti aşıldı" },
          },
        },
      },
      "/sms/bulk": {
        post: {
          summary: "Toplu (kişisel) SMS",
          requestBody: {
            content: {
              "application/json": {
                schema: {
                  type: "object",
                  properties: {
                    messages: {
                      type: "array",
                      maxItems: 5000,
                      items: {
                        type: "object",
                        properties: { to: { type: "string" }, text: { type: "string", minLength: 1 } },
                        required: ["to", "text"],
                      },
                    },
                  },
                  required: ["messages"],
                },
              },
            },
          },
          responses: { "202": { description: "Kuyruğa alındı" }, "402": { description: "Yetersiz bakiye" } },
        },
      },
      "/sms/{id}": {
        get: {
          summary: "Mesaj durumu",
          parameters: [{ name: "id", in: "path", required: true, schema: { type: "string", format: "uuid" } }],
          responses: { "200": { description: "OK" }, "404": { description: "Mesaj bulunamadı" } },
        },
      },
      "/orders": {
        get: {
          summary: "Sipariş listesi",
          parameters: [
            { name: "page", in: "query", schema: { type: "integer", minimum: 1 } },
            { name: "per_page", in: "query", schema: { type: "integer", minimum: 1, maximum: 100 } },
          ],
          responses: { "200": { description: "OK" } },
        },
      },
      "/balance": { get: { summary: "Kalan bakiye", responses: { "200": { description: "OK" } } } },
      "/webhooks/dlr/{provider}": {
        get: {
          summary: "Sağlayıcı DLR webhook (Gatum GET; onay modunda gövde id_state)",
          parameters: [{ name: "provider", in: "path", required: true, schema: { type: "string" } }],
          responses: { "200": { description: "OK" } },
        },
      },
    },
  };
  return NextResponse.json(spec);
}
