// WOLTSMS - saat dilimi yardımcıları
//
// Bayiler tarih/saati Türkiye saatiyle (Europe/Istanbul) girer.
// SMS sağlayıcısı (Gatum/Sempico) İngiltere'de olduğundan, sağlayıcıya iletilen
// planlı gönderim tarihi/saati (beginDate / beginTime) İngiltere saatine
// (Europe/London — kışın GMT/UTC+0, yazın BST/UTC+1) çevrilerek gönderilir.
// Yaz/kış saati geçişleri Intl ile otomatik hesaplanır; sunucunun kendi saat
// diliminden bağımsızdır.

export const TURKEY_TZ = "Europe/Istanbul";
export const PROVIDER_TZ = "Europe/London";

type WallParts = { year: number; month: number; day: number; hour: number; minute: number; second: number };

function wallParts(at: Date, timeZone: string): WallParts {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  const get = (type: string) => Number(fmt.formatToParts(at).find((p) => p.type === type)?.value ?? 0);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24,
    minute: get("minute"),
    second: get("second"),
  };
}

/** Verilen anda saat diliminin UTC'ye göre farkı (dakika). İstanbul → 180, Londra kış → 0, yaz → 60. */
export function zoneOffsetMinutes(at: Date, timeZone: string): number {
  const p = wallParts(at, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((asUtc - Math.floor(at.getTime() / 1000) * 1000) / 60000);
}

const pad = (n: number, w = 2) => String(n).padStart(w, "0");

/**
 * Saat dilimi bilgisi OLMAYAN tarih/saati ("2026-11-05T14:30", "2026-11-05 14:30")
 * Türkiye saati kabul edip UTC ISO'ya çevirir. Z veya +03:00 gibi fark içeren
 * değerler olduğu gibi yorumlanır. Geçersiz değerde null döner.
 */
export function parseTurkeyDateTime(input: string | null | undefined): string | null {
  const raw = String(input ?? "").trim();
  if (!raw) return null;

  // açık saat dilimi bilgisi varsa (Z, +03:00, +0300, -01:00)
  if (/(Z|[+-]\d{2}:?\d{2})$/i.test(raw)) {
    const t = Date.parse(raw);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }

  const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$/);
  if (!m) return null;
  const [, y, mo, d, h = "00", mi = "00", s = "00"] = m;
  const wallAsUtc = Date.UTC(+y, +mo - 1, +d, +h, +mi, +s);
  if (!Number.isFinite(wallAsUtc)) return null;
  // iki adımlı düzeltme: geçiş günlerinde de doğru fark bulunur
  let utc = wallAsUtc - zoneOffsetMinutes(new Date(wallAsUtc), TURKEY_TZ) * 60000;
  utc = wallAsUtc - zoneOffsetMinutes(new Date(utc), TURKEY_TZ) * 60000;
  return new Date(utc).toISOString();
}

/** Bir anı verilen saat diliminde "YYYY-MM-DD" + "HH:MM" (+ saniyeli) olarak biçimlendirir. */
export function formatInZone(at: Date, timeZone: string): { date: string; time: string; timeWithSeconds: string } {
  const p = wallParts(at, timeZone);
  const date = `${pad(p.year, 4)}-${pad(p.month)}-${pad(p.day)}`;
  const time = `${pad(p.hour)}:${pad(p.minute)}`;
  return { date, time, timeWithSeconds: `${time}:${pad(p.second)}` };
}

/**
 * Sağlayıcıya iletilecek planlı gönderim tarihi/saati (İngiltere saati).
 * Geçmiş bir zaman (ör. yeniden denemeler) sağlayıcıya gönderilmez; en erken "şimdi" kullanılır.
 */
export function providerSchedule(
  sendAt: Date | string | null | undefined,
  timeZone: string = PROVIDER_TZ,
  now: Date = new Date()
): { beginDate: string; beginTime: string; at: Date } {
  const t = sendAt instanceof Date ? sendAt.getTime() : sendAt ? Date.parse(sendAt) : NaN;
  const at = new Date(Number.isFinite(t) ? Math.max(t, now.getTime()) : now.getTime());
  const f = formatInZone(at, timeZone);
  return { beginDate: f.date, beginTime: f.time, at };
}

/** Panelde gösterim: anı Türkiye saatiyle yazar (tarayıcının saat diliminden bağımsız). */
export function formatTurkey(at: Date | string | null | undefined): string {
  if (!at) return "-";
  const d = at instanceof Date ? at : new Date(at);
  if (!Number.isFinite(d.getTime())) return "-";
  return d.toLocaleString("tr-TR", { timeZone: TURKEY_TZ });
}
