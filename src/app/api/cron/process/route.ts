import { NextResponse } from "next/server";
import { expireTopups, processScheduledOrders } from "@/lib/services";
import { getActiveProvider } from "@/lib/providers";
import { db } from "@/db";
import { providerSettings, notifications } from "@/db/schema";
import { eq } from "drizzle-orm";

export async function GET(req: Request) {
  const secret = new URL(req.url).searchParams.get("secret");
  if (process.env.CRON_SECRET && secret !== process.env.CRON_SECRET) {
    return NextResponse.json({ success: false, code: 401, message: "Yetkisiz." }, { status: 401 });
  }
  const expired = await expireTopups().catch(() => 0);
  const scheduled = await processScheduledOrders().catch(() => 0);
  // provider balance check
  let providerBalance: number | null = null;
  try {
    const p = await getActiveProvider();
    const b = await p.getBalance();
    providerBalance = b.balance;
    const rows = await db.select().from(providerSettings);
    const active = rows.find((r) => r.isActive);
    if (active) {
      await db.update(providerSettings).set({ balance: String(b.balance) }).where(eq(providerSettings.id, active.id));
      if (b.balance < Number(active.lowBalanceThreshold ?? 1000)) {
        await db.insert(notifications).values({ userId: null, title: "Sağlayıcı bakiyesi düşük", message: `Ana sağlayıcı bakiyesi ${b.balance} - eşik ${active.lowBalanceThreshold}` });
      }
    }
  } catch {}
  return NextResponse.json({ success: true, code: 200, message: "Cron tamamlandı.", data: { expired, scheduled, providerBalance } });
}
