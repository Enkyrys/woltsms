import { NextRequest, NextResponse } from "next/server";

// Route Handler için CORS: yalnız /api/v1 için, kısıtlı.
const ALLOWED_ORIGINS = (process.env.API_CORS_ORIGINS || "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export function corsMiddleware(req: NextRequest): NextResponse | null {
  const path = req.nextUrl.pathname;
  if (!path.startsWith("/api/v1")) return null;

  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.length === 0 ? false : ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes("*");

  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Access-Control-Allow-Headers": "Authorization,Content-Type,Idempotency-Key,X-Idempotency-Key,X-Signature",
    "Access-Control-Max-Age": "86400",
  };
  if (allowed) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Vary"] = "Origin";
  }

  if (req.method === "OPTIONS") {
    return new NextResponse(null, { status: 204, headers });
  }

  return null; // yanıt sonra .headers ile zenginleştirilir
}

export function applyCorsHeaders<T extends Response>(res: T, req: Request): T {
  const path = new URL(req.url).pathname;
  if (!path.startsWith("/api/v1")) return res;
  const origin = req.headers.get("origin") || "";
  const allowed = ALLOWED_ORIGINS.length === 0 ? false : ALLOWED_ORIGINS.includes(origin) || ALLOWED_ORIGINS.includes("*");
  if (allowed) {
    res.headers.set("Access-Control-Allow-Origin", origin);
    res.headers.set("Vary", "Origin");
  }
  return res;
}
