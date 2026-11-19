// Ana sayfa (landing) ayarları — fiyat, paketler ve iletişim bilgileri tek yerden yönetilir.

export const SITE = {
  name: "WOLTSMS",
  // SMS başına birim fiyat (TL). 0,40 TL = 40 kuruş
  // Panelde kullanılan varsayılan birim fiyat veritabanındadır (pricing tablosu, 0022 migration'ı 0,40 yapar).
  pricePerSmsKurus: 40,
  telegramHandle: "@WoltSmsAdmin",
  telegramUrl: "https://t.me/WoltSmsAdmin",
  email: "Enkyryyss@gmail.com",
};

// Paket adetleri (görseldeki adetler)
export const PACKAGES = [
  { name: "Mini Paket", sms: 10_000, featured: false },
  { name: "Standart Paket", sms: 500_000, featured: true },
  { name: "Premium Paket", sms: 1_000_000, featured: false },
] as const;

// kuruş cinsinden tamsayı hesap: kayan nokta hatası olmaz
export function packagePriceTl(sms: number): number {
  return (sms * SITE.pricePerSmsKurus) / 100;
}

export const tl = (n: number, digits = 0) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: digits, maximumFractionDigits: digits });
