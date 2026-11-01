import { ok } from "@/lib/api-response";
import { readFileSync } from "fs";
import { join } from "path";

export const runtime = "nodejs";

// GET /api/openapi.json — docs/openapi.json dosyasını sunar
export async function GET() {
  try {
    const path = join(process.cwd(), "docs", "openapi.json");
    const spec = JSON.parse(readFileSync(path, "utf8"));
    return ok(spec, "OK");
  } catch {
    return ok({ openapi: "3.1.0", info: { title: "WOLTSMS API", version: "1.0.0" }, paths: {} }, "OK");
  }
}
