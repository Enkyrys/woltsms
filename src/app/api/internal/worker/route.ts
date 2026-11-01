import { verifyCronSecret, getSession } from "@/lib/auth";
import { runWorker } from "@/lib/services";
import { unauthorized, ok } from "@/lib/api-response";

export const runtime = "nodejs";
export const maxDuration = 60; // Vercel Pro (Hobby'de 10-60 sn)

// pg_cron → pg_net → POST /api/internal/worker (CRON_SECRET ile)
// Ayrıca panel > Sistem > "Test" butonu admin oturumuyla da tetikleyebilir.
async function authorize(req: Request): Promise<boolean> {
  if (await verifyCronSecret(req)) return true;
  const s = await getSession();
  return Boolean(s?.isAdmin);
}

export async function POST(req: Request) {
  const valid = await authorize(req);
  if (!valid) return unauthorized("Yetkisiz.");

  const started = Date.now();
  try {
    const result = await runWorker();
    return ok({ ...result, durationMs: Date.now() - started }, "Worker tamamlandı.");
  } catch (e) {
    return ok(
      { error: e instanceof Error ? e.message : "worker_error", durationMs: Date.now() - started },
      "Worker kısmen çalıştı.",
      undefined,
      { status: 500 }
    );
  }
}

// GET de desteklenir (eski cron URL'leriyle uyum)
export async function GET(req: Request) {
  return POST(req);
}
