import { z } from "zod";
import { getSession } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, unauthorized, badRequest } from "@/lib/api-response";

export const runtime = "nodejs";

// Tarayıcıdan DOĞRUDAN Supabase Storage'a imzalı yükleme URL'i üretir.
// Vercel gövde sınırı (~4.5 MB) aşılmaz; 25 MB dosyalar fonksiyondan geçmez.
const Schema = z.object({
  bucket: z.enum(["receipts", "imports", "exports"]),
  filename: z.string().min(1).max(200),
  contentType: z.string().min(1),
});

const LIMITS: Record<string, number> = {
  receipts: 5 * 1024 * 1024, // 5 MB
  imports: 25 * 1024 * 1024, // 25 MB
  exports: 50 * 1024 * 1024, // 50 MB
};

const ALLOWED: Record<string, string[]> = {
  receipts: ["image/jpeg", "image/png", "image/webp", "application/pdf"],
  imports: [
    "text/csv",
    "text/plain",
    "application/vnd.ms-excel",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "application/octet-stream", // tarayıcı bazı xlsx'leri böyle gönderir; uzantı ile doğrularız
  ],
  exports: ["text/csv", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"],
};

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return badRequest("Geçersiz istek.");
  const { bucket, filename, contentType } = parsed.data;

  if (!ALLOWED[bucket].includes(contentType)) {
    return badRequest("Desteklenmeyen dosya türü.");
  }

  // uzantı kontrolü (MIME spoofing'e karşı)
  const ext = filename.split(".").pop()?.toLowerCase() || "";
  const okExt: Record<string, string[]> = {
    receipts: ["jpg", "jpeg", "png", "webp", "pdf"],
    imports: ["csv", "txt", "xls", "xlsx"],
    exports: ["csv", "xlsx"],
  };
  if (!okExt[bucket].includes(ext)) return badRequest("Desteklenmeyen uzantı.");

  const safeName = filename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-100);
  const path = `${s.id}/${Date.now()}-${safeName}`;

  const admin = createAdminClient();
  const { data, error } = await admin.storage.from(bucket).createSignedUploadUrl(path);
  if (error) return badRequest(`Yükleme URL'i üretilemedi: ${error.message}`);

  return ok(
    {
      token: data.token,
      path: data.path,
      bucket,
      maxSize: LIMITS[bucket],
      uploadUrl: `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/upload/${bucket}/${data.path}`,
    },
    "Yükleme URL'i hazır. Dosyayı bu URL'e doğrudan PUT ile yükleyin."
  );
}
