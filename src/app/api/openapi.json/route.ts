import { NextResponse } from "next/server";

export async function GET() {
  const spec = {
    openapi: "3.0.3",
    info: { title: "WOLTSMS API", version: "1.0.0", description: "WOLTSMS Bayi SMS Paneli - Public API. Auth: X-API-Key + X-Signature (HMAC-SHA256) veya Bearer token." },
    servers: [{ url: "/api/v1" }],
    security: [{ ApiKey: [] }],
    components: {
      securitySchemes: {
        ApiKey: { type: "apiKey", in: "header", name: "X-API-Key" },
        Bearer: { type: "http", scheme: "bearer" },
      },
    },
    paths: {
      "/sms/send": {
        post: {
          summary: "SMS Gönder",
          requestBody: { content: { "application/json": { schema: { type: "object", properties: { recipients: { type: "array", items: { type: "string" } }, message: { type: "string" }, schedule_at: { type: "string" }, callback_url: { type: "string" } }, required: ["recipients", "message"] } } } },
          responses: { "200": { description: "OK" }, "402": { description: "Yetersiz bakiye" } },
        },
      },
      "/sms/bulk": {
        post: {
          summary: "Toplu (kişisel) SMS",
          requestBody: { content: { "application/json": { schema: { type: "object", properties: { messages: { type: "array", items: { type: "object", properties: { to: { type: "string" }, text: { type: "string" } } } } } } } } },
          responses: { "200": { description: "OK" } },
        },
      },
      "/sms/{id}": { get: { summary: "Mesaj durumu", parameters: [{ name: "id", in: "path", required: true, schema: { type: "integer" } }], responses: { "200": { description: "OK" } } } },
      "/orders": { get: { summary: "Sipariş listesi", responses: { "200": { description: "OK" } } } },
      "/balance": { get: { summary: "Kalan kredi", responses: { "200": { description: "OK" } } } },
      "/webhooks/dlr/{provider}": { post: { summary: "Sağlayıcı DLR webhook", parameters: [{ name: "provider", in: "path", required: true, schema: { type: "string" } }], responses: { "200": { description: "OK" } } } },
    },
  };
  return NextResponse.json(spec);
}
