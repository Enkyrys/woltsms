// WOLTSMS - Segment hesabı: paylaşılan TS modülü (lib/sms-segments.ts)
// Veritabanı aynısı: public.sms_segments() / public.sms_detect_encoding() (migration 0004)
// Kurallar: GSM tek parça 160 / çok parça 153; UCS-2 tek 70 / çok 67.
// Kodlama: GSM 03.38 temel alfabe + genişletme tablosu dışındaki her karakter UCS-2'ye zorlar.
//   Türkçe ş Ş ğ Ğ ı İ ve küçük ç tabloda yoktur => UCS-2. (Ç, ö, ü, Ö, Ü tabloda vardır.)
// Uzunluk: GSM'de genişletme karakterleri (^ { } \ [ ~ ] | €) 2 septet;
//          UCS-2'de UTF-16 kod birimi sayısı (emoji gibi BMP dışı karakter = 2).

const GSM_BASIC = new Set(
  [
    ...("@£$¥èéùìòÇ\nØø\rÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ" +
      " !\"#¤%&'()*+,-./0123456789:;<=>?¡ABCDEFGHIJKLMNOPQRSTUVWXYZÄÖÑÜ§¿" +
      "abcdefghijklmnopqrstuvwxyzäöñüà"),
  ]
);
const GSM_EXTENDED = new Set(["^", "{", "}", "\\", "[", "~", "]", "|", "€"]);

export type Encoding = "GSM" | "UCS2";

export function detectEncoding(message: string): Encoding {
  for (const ch of message) {
    if (!GSM_BASIC.has(ch) && !GSM_EXTENDED.has(ch)) return "UCS2";
  }
  return "GSM";
}

export function gsmLength(message: string): number {
  let len = 0;
  for (const ch of message) {
    len += GSM_EXTENDED.has(ch) ? 2 : 1;
  }
  return len;
}

export function effectiveLength(message: string, encoding: Encoding): number {
  if (encoding === "UCS2") return message.length; // UTF-16 kod birimi
  return gsmLength(message);
}

export function calcSegments(message: string): {
  encoding: Encoding;
  length: number;
  segments: number;
  perSegment: number;
} {
  if (!message) return { encoding: "GSM", length: 0, segments: 0, perSegment: 160 };
  const encoding = detectEncoding(message);
  const length = effectiveLength(message, encoding);
  const single = encoding === "GSM" ? 160 : 70;
  const multi = encoding === "GSM" ? 153 : 67;
  const perSegment = length <= single ? single : multi;
  const segments = length === 0 ? 0 : Math.max(1, Math.ceil(length / perSegment));
  return { encoding, length, segments, perSegment };
}

// 05xx / +90 / 90 / 0090 → 905xxxxxxxxx; geçersizse null
export function normalizePhone(phone: string): string | null {
  let v = (phone || "").replace(/[^0-9+]/g, "");
  if (v.startsWith("+")) v = v.slice(1);
  if (v.startsWith("00")) v = v.slice(2);
  if (v.startsWith("0")) v = v.slice(1);
  if (v.startsWith("90")) v = v.slice(2);
  if (!/^5[0-9]{9}$/.test(v)) return null;
  return `90${v}`;
}

// maskeleme (loglar için): 905XX1234567 → 905XX***4567
export function maskPhone(phone: string): string {
  const p = String(phone || "");
  if (p.length < 7) return "***";
  return `${p.slice(0, 5)}***${p.slice(-4)}`;
}

export function maskBody(body: string): string {
  const b = String(body || "");
  if (b.length <= 8) return b ? "***" : "";
  return `${b.slice(0, 8)}…`;
}

// virgül, noktalı virgül, newline kabul eder
export function parseRecipients(text: string): string[] {
  const parts = (text || "")
    .replace(/[\r\n;]/g, ",")
    .split(",")
    .map((s) => s.replace(/[^0-9+]/g, ""))
    .filter(Boolean);
  return [...new Set(parts)];
}

export function validateAndNormalizeList(list: string[]): {
  valid: string[];
  invalidCount: number;
} {
  const seen = new Set<string>();
  const valid: string[] = [];
  let invalidCount = 0;
  for (const raw of list) {
    const n = normalizePhone(raw);
    if (n && !seen.has(n)) {
      seen.add(n);
      valid.push(n);
    } else if (!n) {
      invalidCount++;
    }
  }
  return { valid, invalidCount };
}

// Gönderim penceresi: Europe/Istanbul, varsayılan 24 saat (00:00–23:59).
// Saat değerleri normalize edilir: başlangıç 24 → 0 (24:00 = gece yarısı),
// bitiş 0 veya ≥ 24 → 24 (gün sonu 23:59 dahil), başlangıç = bitiş → 24 saat,
// bitiş < başlangıç → gece yarısını aşan pencere. SQL in_sending_window ile aynı kural.
export const DEFAULT_SENDING_START_HOUR = 0;
export const DEFAULT_SENDING_END_HOUR = 24;

export function normalizeSendingHours(startHour: number, endHour: number): { start: number; end: number; allDay: boolean } {
  const s = Number.isFinite(startHour) ? Math.trunc(startHour) : DEFAULT_SENDING_START_HOUR;
  let e = Number.isFinite(endHour) ? Math.trunc(endHour) : DEFAULT_SENDING_END_HOUR;
  const start = ((s % 24) + 24) % 24;
  if (e <= 0 || e >= 24) e = 24;
  return { start, end: e, allDay: (start === 0 && e === 24) || start === e };
}

function istanbulHour(at: Date): number {
  const fmt = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Istanbul",
    hour: "2-digit",
    hourCycle: "h23",
  });
  return Number(fmt.format(at)) % 24;
}

export function isWithinSendingWindow(
  at: Date = new Date(),
  startHour = DEFAULT_SENDING_START_HOUR,
  endHour = DEFAULT_SENDING_END_HOUR
): boolean {
  const w = normalizeSendingHours(startHour, endHour);
  if (w.allDay) return true;
  const hour = istanbulHour(at);
  return w.start < w.end ? hour >= w.start && hour < w.end : hour >= w.start || hour < w.end;
}

// pencere dışındaysa pencerenin ilk uygun anına kaydır (içindeyse aynı anı döner).
// Europe/Istanbul 2016'dan beri sabit UTC+3 olduğundan sunucu saat diliminden bağımsızdır.
const IST_OFFSET_MS = 3 * 3600_000;
export function nextWindowStart(
  at: Date,
  startHour = DEFAULT_SENDING_START_HOUR,
  endHour = DEFAULT_SENDING_END_HOUR
): Date {
  if (isWithinSendingWindow(at, startHour, endHour)) return at;
  const { start } = normalizeSendingHours(startHour, endHour);
  const local = new Date(at.getTime() + IST_OFFSET_MS); // UTC alanları = İstanbul duvar saati
  const hour = local.getUTCHours();
  const dayStart = Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate());
  const dayOffset = hour < start ? 0 : 1;
  return new Date(dayStart + dayOffset * 86400_000 + start * 3600_000 - IST_OFFSET_MS);
}

// Ayar değeri "24:00", "23:59", "10", "10:00", "22.00" olabilir → tam saat (SQL normalize_hour_setting ile aynı).
//   başlangıç "24:00" → 0, bitiş "23:59" → 24, bitiş "22:30" → 23
export function normalizeHourSetting(kind: "start" | "end", raw: unknown): number | null {
  const m = String(raw ?? "").trim().match(/^(\d{1,2})(?:[:.](\d{1,2}))?(?::\d{1,2})?$/);
  if (!m) return null;
  let h = Number(m[1]);
  const mi = Number(m[2] ?? 0);
  if (mi > 59 || h > 24) return null;
  if (kind === "start") return h >= 24 ? 0 : h;
  if (mi > 0) h += 1;
  return h <= 0 || h >= 24 ? 24 : h;
}

// panelde gösterim: başlangıç 0 → "24:00", bitiş 24 → "23:59"
export function displayHourSetting(kind: "start" | "end", raw: unknown): string {
  const h = normalizeHourSetting(kind, raw);
  if (h === null) return String(raw ?? "");
  if (kind === "start") return h === 0 ? "24:00" : `${String(h).padStart(2, "0")}:00`;
  return h === 24 ? "23:59" : `${String(h).padStart(2, "0")}:00`;
}
