import { createAdminClient } from "@/lib/supabase/admin";
import { ok } from "@/lib/api-response";

export const runtime = "nodejs";

// Basit sağlık kontrolü
export async function GET() {
  try {
    const admin = createAdminClient();
    const { error } = await admin.from("system_settings").select("key").limit(1);
    return ok(
      {
        status: error ? "degraded" : "ok",
        db: error ? "error" : "ok",
        time: new Date().toISOString(),
      },
      "OK"
    );
  } catch (e) {
    return ok({ status: "error", message: e instanceof Error ? e.message : "error" }, "OK", undefined, {
      status: 503,
    });
  }
}
