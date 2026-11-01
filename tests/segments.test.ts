import { describe, it, expect } from "vitest";
import {
  detectEncoding,
  calcSegments,
  normalizePhone,
  validateAndNormalizeList,
  parseRecipients,
  gsmLength,
  effectiveLength,
  isWithinSendingWindow,
  maskPhone,
  maskBody,
  nextWindowStart,
} from "@/lib/sms-segments";

describe("segment hesabı — GSM", () => {
  it("kısa ASCII mesaj 1 segment", () => {
    const r = calcSegments("Merhaba dunya");
    expect(r.encoding).toBe("GSM");
    expect(r.segments).toBe(1);
    expect(r.perSegment).toBe(160);
  });

  it("tam 160 karakter = 1 segment", () => {
    const msg = "a".repeat(160);
    expect(calcSegments(msg).segments).toBe(1);
  });

  it("161 karakter = 2 segment (153'lik parçalar)", () => {
    const r = calcSegments("a".repeat(161));
    expect(r.segments).toBe(2);
    expect(r.perSegment).toBe(153);
  });

  it("306 karakter = 2, 307 = 3 (çok parçalı)", () => {
    expect(calcSegments("a".repeat(306)).segments).toBe(2);
    expect(calcSegments("a".repeat(307)).segments).toBe(3);
  });

  it("GSM genişletilmiş karakterler 2 sayılır", () => {
    // [ ve ] birer genişletilmiş karakter → 2 septet
    expect(gsmLength("[a]")).toBe(5); // [ =2, a =1, ] =2
    expect(calcSegments("[".repeat(80)).segments).toBe(1); // 160 septet
    expect(calcSegments("[".repeat(81)).segments).toBe(2); // 162 septet → 2
  });

  it("boş mesaj 0 segment", () => {
    expect(calcSegments("").segments).toBe(0);
  });
});

describe("segment hesabı — UCS-2 (Türkçe karakterler)", () => {
  it("ş/ğ/ı/İ UCS-2'ye zorlar", () => {
    expect(detectEncoding("başlık")).toBe("UCS2");
    expect(detectEncoding("ağaç")).toBe("UCS2");
    expect(detectEncoding("ışık")).toBe("UCS2");
    expect(detectEncoding("İstanbul")).toBe("UCS2");
  });

  it("GSM 03.38 tablosundaki Latin harfler GSM kalır (ö ü Ö Ü Ç é è ù à ä ñ ß)", () => {
    expect(detectEncoding("Çöl Öğ Ünl Ä Ñ àéùìò ß")).toBe("UCS2"); // ğ tabloda yok
    expect(detectEncoding("Çöl Ö Ünl Ä Ñ àéùìò ß")).toBe("GSM");
    expect(detectEncoding("öü ÖÜ Ç")).toBe("GSM");
  });

  it("küçük ç GSM tablosunda yoktur => UCS-2 (büyük Ç tabloda var)", () => {
    expect(detectEncoding("çay")).toBe("UCS2");
    expect(detectEncoding("Çay")).toBe("GSM");
  });

  it("tabloda olmayan aksanlı harfler (î õ ê â ô û ï ë ÿ) UCS-2'ye zorlar", () => {
    for (const ch of ["î", "õ", "ê", "â", "ô", "û", "ï", "ë", "ÿ"]) {
      expect(detectEncoding("a" + ch + "b")).toBe("UCS2");
    }
  });

  it("akıllı tırnak ve emoji UCS-2'ye zorlar", () => {
    expect(detectEncoding("It\u2019s")).toBe("UCS2");
    expect(detectEncoding("selam \u{1F600}")).toBe("UCS2");
  });

  it("UCS-2 tek parça 70", () => {
    const r = calcSegments("ş".repeat(70));
    expect(r.encoding).toBe("UCS2");
    expect(r.segments).toBe(1);
    expect(r.perSegment).toBe(70);
  });

  it("UCS-2 71 karakter = 2 segment (67)", () => {
    const r = calcSegments("ş".repeat(71));
    expect(r.segments).toBe(2);
    expect(r.perSegment).toBe(67);
  });

  it("UCS-2 134 = 2, 135 = 3", () => {
    expect(calcSegments("ğ".repeat(134)).segments).toBe(2);
    expect(calcSegments("ğ".repeat(135)).segments).toBe(3);
  });

  it("effectiveLength UCS-2'de UTF-16 kod birimi sayar", () => {
    expect(effectiveLength("şşş", "UCS2")).toBe(3);
    expect(effectiveLength("abc", "GSM")).toBe(3);
    // emoji BMP dışı: 2 kod birimi
    expect(effectiveLength("\u{1F600}", "UCS2")).toBe(2);
    expect(calcSegments("\u{1F600}".repeat(35)).segments).toBe(1); // 70 birim
    expect(calcSegments("\u{1F600}".repeat(36)).segments).toBe(2); // 72 birim
  });
});

describe("maliyet = segment × birim fiyat", () => {
  it("hesaplama doğru", () => {
    const unit = 1.5;
    const segs = calcSegments("ş".repeat(71)).segments; // 2
    expect(segs * unit).toBe(3);
    expect(calcSegments("Merhaba").segments * unit).toBe(1.5);
  });
});

describe("telefon normalizasyonu", () => {
  it("05xx → 905xx", () => {
    expect(normalizePhone("05321234567")).toBe("905321234567");
  });
  it("+90 → 90", () => {
    expect(normalizePhone("+90 532 123 45 67")).toBe("905321234567");
  });
  it("90 ile başlayan", () => {
    expect(normalizePhone("905321234567")).toBe("905321234567");
  });
  it("0090 öneki", () => {
    expect(normalizePhone("00905321234567")).toBe("905321234567");
  });
  it("9 ile başlayan (5321234567)", () => {
    expect(normalizePhone("5321234567")).toBe("905321234567");
  });
  it("noktalı/boşluklu", () => {
    expect(normalizePhone("0532 123 45 67")).toBe("905321234567");
    expect(normalizePhone("(0532) 123-45-67")).toBe("905321234567");
  });
  it("geçersiz numara null döner", () => {
    expect(normalizePhone("12345")).toBeNull();
    expect(normalizePhone("0532123456")).toBeNull(); // 10 hane değil
    expect(normalizePhone("053212345678")).toBeNull(); // fazladan hane
    expect(normalizePhone("")).toBeNull();
  });
  it("geçersizleri atar, geçerlileri benzersizleştirir", () => {
    const { valid, invalidCount } = validateAndNormalizeList([
      "05321234567",
      "05321234567", // tekrar
      "+90 532 123 45 67", // aynı numara farklı biçim
      "12345", // geçersiz
    ]);
    expect(valid).toEqual(["905321234567"]);
    expect(invalidCount).toBe(1);
  });
});

describe("parseRecipients", () => {
  it("virgül, noktalı virgül ve yeni satırı ayırır", () => {
    const r = parseRecipients("05321234567;05331234567\n05341234567, 05351234567");
    expect(r).toHaveLength(4);
  });
  it("tekrarları ayıklar", () => {
    expect(parseRecipients("05321234567,05321234567")).toHaveLength(1);
  });
});

describe("gönderim penceresi (10:00–22:00 Europe/Istanbul)", () => {
  // Europe/Istanbul = UTC+3 (yaz saati farkı yok)
  it("11:00 UTC = 14:00 IST → içinde", () => {
    expect(isWithinSendingWindow(new Date("2026-01-01T11:00:00Z"))).toBe(true);
  });
  it("07:00 UTC = 10:00 IST → sınır (içinde)", () => {
    expect(isWithinSendingWindow(new Date("2026-01-01T07:00:00Z"))).toBe(true);
  });
  it("06:59 UTC = 09:59 IST → dışında", () => {
    expect(isWithinSendingWindow(new Date("2026-01-01T06:59:00Z"))).toBe(false);
  });
  it("19:00 UTC = 22:00 IST → dışında (bitiş exclusive)", () => {
    expect(isWithinSendingWindow(new Date("2026-01-01T19:00:00Z"))).toBe(false);
  });
  it("18:59 UTC = 21:59 IST → içinde", () => {
    expect(isWithinSendingWindow(new Date("2026-01-01T18:59:00Z"))).toBe(true);
  });
  it("özel saat aralığı", () => {
    expect(isWithinSendingWindow(new Date("2026-01-01T12:00:00Z"), 0, 24)).toBe(true);
  });
});

describe("maskeleme (loglar için KVKK)", () => {
  it("telefon maskelenir", () => {
    expect(maskPhone("905321234567")).toBe("90532***4567");
  });
  it("kısa telefon tamamen maskelenir", () => {
    expect(maskPhone("123")).toBe("***");
  });
  it("kısa mesaj maskelenir", () => {
    expect(maskBody("abc")).toBe("***");
  });
  it("uzun mesaj kırpılır", () => {
    expect(maskBody("bu bir deneme mesajidir")).toBe("bu bir d…");
  });
});

describe("nextWindowStart (sunucu saat diliminden bağımsız)", () => {
  it("pencere içindeyse aynı anı döner", () => {
    const at = new Date("2026-01-01T11:00:00Z"); // 14:00 IST
    expect(nextWindowStart(at).toISOString()).toBe(at.toISOString());
  });
  it("22:00 sonrası ertesi gün 10:00 IST", () => {
    const at = new Date("2026-01-01T19:30:00Z"); // 22:30 IST
    expect(nextWindowStart(at).toISOString()).toBe("2026-01-02T07:00:00.000Z");
  });
  it("10:00 öncesi aynı gün 10:00 IST", () => {
    const at = new Date("2026-01-01T02:00:00Z"); // 05:00 IST
    expect(nextWindowStart(at).toISOString()).toBe("2026-01-01T07:00:00.000Z");
  });
});
