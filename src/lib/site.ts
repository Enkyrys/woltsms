// Ana sayfa (landing) ayarları — fiyat, paketler ve iletişim bilgileri tek yerden yönetilir.
// E-posta için Vercel'de NEXT_PUBLIC_CONTACT_EMAIL ortam değişkenini girin (yeniden deploy gerekir).

export const SITE = {
  name: "WOLTSMS",
  // SMS başına birim fiyat (TL). 0,35 TL = 35 kuruş
  pricePerSmsKurus: 35,
  telegramUrl: "https://t.me/Woltbetresmii",
  telegramHandle: "@Woltbetresmii",
  whatsappUrl: "https://whatsapp.com/channel/0029Vb975mZIHphGn5lzbT0X",
  // E-posta tanımlı değilse e-posta kartı ve bağlantıları gizlenir
  email: process.env.NEXT_PUBLIC_CONTACT_EMAIL || "",
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
