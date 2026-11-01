import { z } from "zod";
import { getSession, hasPermissionSync } from "@/lib/auth";
import { createAdminClient } from "@/lib/supabase/admin";
import { ok, unauthorized, forbidden, badRequest } from "@/lib/api-response";

export const runtime = "nodejs";
export const maxDuration = 20;

// Storage'a yüklenmiş dosyadan içe aktarma işini kuyruğa alır.
// Ayrıştırma worker'da yapılır (uzun iş istek içinde yapılmaz).
const Schema = z.object({
  kind: z.enum(["contact_list", "blacklist"]),
  storagePath: z.string().min(1),
  filename: z.string().min(1),
  listId: z.string().uuid().optional(), // mevcut rehbere ekleme
  listTitle: z.string().optional(), // yeni rehber başlığı
});

export async function POST(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();

  const body = await req.json().catch(() => ({}));
  const parsed = Schema.safeParse(body);
  if (!parsed.success) return badRequest(parsed.error.errors[0]?.message || "Geçersiz istek.");
  const { kind, storagePath, filename, listId, listTitle } = parsed.data;

  if (kind === "blacklist" && !hasPermissionSync(s, "blacklist.manage")) return forbidden();
  if (kind === "contact_list" && !hasPermissionSync(s, "contacts.manage")) return forbidden();

  // path kullanıcının klasöründe mi?
  if (!storagePath.startsWith(`${s.id}/`)) return badRequest("Geçersiz dosya yolu.");

  const admin = createAdminClient();

  // rehbere ekleme ise listeyi doğrula
  if (kind === "contact_list" && listId) {
    const { data: list } = await admin.from("contact_lists").select("id, user_id").eq("id", listId).maybeSingle();
    if (!list || list.user_id !== s.id) return badRequest("Rehber bulunamadı.");
  }

  const { data: job, error } = await admin
    .from("import_jobs")
    .insert({
      user_id: s.id,
      kind,
      list_id: listId ?? null,
      storage_path: storagePath,
      filename,
      status: "pending",
    })
    .select("*")
    .single();

  if (error) return badRequest(error.message);

  // yeni rehber başlığı varsa şimdi oluştur (worker numaraları yazar)
  let targetListId = listId ?? null;
  if (kind === "contact_list" && !listId) {
    const { data: created } = await admin
      .from("contact_lists")
      .insert({ user_id: s.id, title: listTitle || filename })
      .select("id")
      .single();
    targetListId = created?.id ?? null;
    await admin.from("import_jobs").update({ list_id: targetListId }).eq("id", job.id);
  }

  // iş kuyruğa (jobs tablosu; pg_cron worker'ı çeker)
  await admin.from("jobs").insert({
    type: "import_file",
    payload: { importJobId: job.id, userId: s.id, kind, storagePath, bucket: "imports", listId: targetListId },
  });

  return ok(
    {
      id: job.id,
      status: "pending",
      listId: targetListId,
      pollUrl: `/api/panel/import?id=${job.id}`,
    },
    "Dosya kuyruğa alındı. İlerleme bu sayfada canlı izlenir."
  );
}

// GET: içe aktarma durumu
export async function GET(req: Request) {
  const s = await getSession();
  if (!s) return unauthorized();
  const admin = createAdminClient();
  const url = new URL(req.url);
  const id = url.searchParams.get("id");

  if (id) {
    const { data } = await admin.from("import_jobs").select("*").eq("id", id).maybeSingle();
    if (!data || data.user_id !== s.id) return badRequest("İş bulunamadı.");
    return ok({
      id: data.id,
      status: data.status,
      total: data.total,
      imported: data.imported,
      duplicates: data.duplicates,
      blacklisted: data.blacklisted,
      invalid: data.invalid,
      error: data.error,
      filename: data.filename,
      createdAt: data.created_at,
      updatedAt: data.updated_at,
    });
  }

  const page = Math.max(1, Number(url.searchParams.get("page") || 1));
  const perPage = Math.min(50, Number(url.searchParams.get("perPage") || 10));
  const { count, data } = await admin
    .from("import_jobs")
    .select("*", { count: "exact" })
    .eq("user_id", s.id)
    .order("created_at", { ascending: false })
    .range((page - 1) * perPage, page * perPage - 1);

  return ok(
    (data ?? []).map((j) => ({
      id: j.id,
      kind: j.kind,
      filename: j.filename,
      status: j.status,
      total: j.total,
      imported: j.imported,
      duplicates: j.duplicates,
      blacklisted: j.blacklisted,
      invalid: j.invalid,
      error: j.error,
      createdAt: j.created_at,
    })),
    "OK",
    { total: count ?? 0, page, perPage }
  );
}
