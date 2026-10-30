// GSM / UCS-2 segment hesabı + telefon normalizasyonu + gönderim saati kuralı
const TURKISH_UCS2_CHARS = new Set(["ş", "Ş", "ğ", "Ğ", "ı", "İ"]);
// GSM 7-bit extended chars counted as 2
const GSM_EXTENDED = new Set(["^", "{", "}", "\\", "[", "~", "]", "|", "€"]);

export type Encoding = "GSM" | "UCS2";

export function detectEncoding(message: string): Encoding {
  for (const ch of message) {
    const code = ch.charCodeAt(0);
    if (TURKISH_UCS2_CHARS.has(ch)) return "UCS2";
    // sms spec: ş, ğ, ı, İ force UCS2
    if (code > 127) {
      // allow common latin-1 GSM chars + € (GSM extended, 2 septets)
      if (ch === "€") continue;
      if (!"çÇöÖüÜéèêëàâäîïôöùûÿñß".includes(ch)) return "UCS2";
    }
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
  if (encoding === "UCS2") return [...message].length;
  return gsmLength(message);
}

export function calcSegments(message: string): { encoding: Encoding; length: number; segments: number; perPart: number } {
  if (!message) return { encoding: "GSM", length: 0, segments: 0, perPart: 160 };
  const encoding = detectEncoding(message);
  const length = effectiveLength(message, encoding);
  let perPart: number;
  let segments: number;
  if (encoding === "GSM") {
    if (length <= 160) {
      perPart = 160;
      segments = length === 0 ? 0 : 1;
    } else {
      perPart = 153;
      segments = Math.ceil(length / 153);
    }
  } else {
    if (length <= 70) {
      perPart = 70;
      segments = length === 0 ? 0 : 1;
    } else {
      perPart = 67;
      segments = Math.ceil(length / 67);
    }
  }
  return { encoding, length, segments, perPart };
}

// Counter display like reference: "0/155" style -> remaining in current segment
export function counterText(message: string): string {
  const { length, segments, perPart } = calcSegments(message);
  if (!message) return "0/155";
  const usedInCurrent = length - (segments - 1) * perPart;
  return `${usedInCurrent}/${perPart}`;
}

export function parseRecipients(input: string): string[] {
  if (!input) return [];
  return input
    .split(/[,\n;]+/)
    .map((s) => s.trim())
    .filter(Boolean);
}

export function normalizePhone(raw: string): string | null {
  if (!raw) return null;
  let d = raw.replace(/\D/g, "");
  if (!d) return null;
  // Turkey handling
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("90") && d.length === 12) return d;
  if (d.startsWith("0") && d.length === 11) return "90" + d.slice(1);
  if (d.length === 10 && d.startsWith("5")) return "90" + d;
  if (d.length === 11 && d.startsWith("5")) return "90" + d.slice(1);
  // generic international: require 10-15 digits
  if (d.length >= 10 && d.length <= 15) return d;
  return null;
}

export function validateAndNormalizeList(phones: string[]): { valid: string[]; invalid: string[] } {
  const valid: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const p of phones) {
    const n = normalizePhone(p);
    if (!n || seen.has(n)) {
      if (!n) invalid.push(p);
      continue;
    }
    seen.add(n);
    valid.push(n);
  }
  return { valid, invalid };
}

export function isWithinSendingWindow(now: Date, startHour: number, endHour: number): boolean {
  // Use Europe/Istanbul time
  const tr = new Date(now.toLocaleString("en-US", { timeZone: "Europe/Istanbul" }));
  const h = tr.getHours();
  const m = tr.getMinutes();
  const cur = h + m / 60;
  return cur >= startHour && cur < endHour;
}

export function maskPhone(phone: string): string {
  if (phone.length <= 5) return "***";
  return phone.slice(0, 4) + "****" + phone.slice(-2);
}

export function maskMessage(msg: string): string {
  if (!msg) return "";
  if (msg.length <= 12) return msg.slice(0, 3) + "***";
  return msg.slice(0, 8) + "***(" + msg.length + " karakter)";
}
