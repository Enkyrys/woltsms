import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

// Kısa URL yönlendirme: /s/[slug] → 302 (hızlı)
export async function GET(_req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;
  const admin = createAdminClient();

  const { data } = await admin.rpc("short_url_click", { p_slug: slug });
  const row = Array.isArray(data) ? data[0] : (data as { original_url?: string } | null);
  const original = row?.original_url;
  if (!original) {
    return NextResponse.json({ success: false, code: 404, message: "Kısa URL bulunamadı." }, { status: 404 });
  }
  return NextResponse.redirect(original, 302);
}
