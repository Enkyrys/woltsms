import { NextResponse } from "next/server";

// WOLTSMS API yanıt zarfı: { success, code, message, data, meta? }
// Frontend bu şekle bağımlıdır; korunur.
export type Envelope<T = unknown> = {
  success: boolean;
  code: number;
  message: string;
  data?: T;
  meta?: Record<string, unknown>;
};

export function ok<T>(data: T, message = "OK", meta?: Record<string, unknown>, init?: { status?: number }) {
  const body: Envelope<T> = { success: true, code: init?.status ?? 200, message, data, ...(meta ? { meta } : {}) };
  return NextResponse.json(body, { status: init?.status ?? 200 });
}

export function created<T>(data: T, message = "Oluşturuldu", meta?: Record<string, unknown>) {
  const body: Envelope<T> = { success: true, code: 201, message, data, ...(meta ? { meta } : {}) };
  return NextResponse.json(body, { status: 201 });
}

export function accepted<T>(data: T, message = "Kuyruğa alındı", meta?: Record<string, unknown>) {
  const body: Envelope<T> = { success: true, code: 202, message, data, ...(meta ? { meta } : {}) };
  return NextResponse.json(body, { status: 202 });
}

export function fail(code: number, message: string, data?: unknown) {
  const body: Envelope = { success: false, code, message, ...(data !== undefined ? { data } : {}) };
  return NextResponse.json(body, { status: code });
}

// 400 / 401 / 402 / 403 / 404 / 409 / 422 / 429 / 500 kısayolları
export const badRequest = (m: string) => fail(400, m);
export const unauthorized = (m = "Oturum gerekli.") => fail(401, m);
export const paymentRequired = (m = "Yetersiz bakiye.") => fail(402, m);
export const forbidden = (m = "Yetkiniz yok.") => fail(403, m);
export const notFound = (m = "Bulunamadı.") => fail(404, m);
export const conflict = (m: string) => fail(409, m);
export const unprocessable = (m: string) => fail(422, m);
export const tooMany = (m = "İstek limiti aşıldı.") => fail(429, m);
export const serverError = (m = "Sunucu hatası.") => fail(500, m);
