// Merkezi SEO ayarları: alan adı, anahtar kelimeler, SSS ve JSON-LD (schema.org) verisi.
import { SITE, PACKAGES, packagePriceTl } from "@/lib/site";

// Canlı alan adınızı .env dosyasında tanımlayın: NEXT_PUBLIC_SITE_URL=https://alanadiniz.com
// (tanımlı değilse APP_URL, o da yoksa localhost kullanılır)
export const SITE_URL = (
  process.env.NEXT_PUBLIC_SITE_URL ||
  process.env.APP_URL ||
  "http://localhost:3000"
).replace(/\/+$/, "");

export const SEO = {
  name: SITE.name,
  title: "Toplu SMS Gönder | Ucuz Toplu SMS Paketleri ve Bayi SMS Paneli",
  description:
    "WOLTSMS ile toplu SMS gönderin: ucuz toplu SMS paketleri, bayi SMS paneli, SMS API entegrasyonu, zamanlanmış gönderim, kısa URL ve anlık raporlama. Hemen üye olun.",
  locale: "tr_TR",
  // Not: Google "keywords" meta etiketini sıralamada kullanmaz; yine de Bing/Yandex ve
  // diğer sistemler için bırakıldı. Asıl etki başlık, H1-H2 ve sayfa içeriğindeki kullanımdır.
  keywords: [
    "toplu sms",
    "toplu sms gönder",
    "toplu sms paketleri",
    "toplu sms fiyatları",
    "ucuz toplu sms",
    "sms paneli",
    "bayi sms paneli",
    "sms bayiliği",
    "sms api",
    "toplu sms api",
    "kurumsal sms",
    "reklam sms",
    "bilgilendirme sms",
    "otp sms",
    "zamanlanmış sms",
    "sms gönderme programı",
    "sms kısa url",
    "excel ile toplu sms",
    "web üzerinden sms gönder",
    "bulk sms türkiye",
  ],
} as const;

export const FAQ = [
  {
    q: "Toplu SMS nedir, nasıl gönderilir?",
    a: "Toplu SMS, tek bir mesajın yüzlerce ya da binlerce kişiye aynı anda iletilmesidir. WOLTSMS panelinde numaralarınızı yapıştırır ya da Excel ile yükler, mesajınızı yazar ve gönderirsiniz.",
  },
  {
    q: "Toplu SMS fiyatları nedir?",
    a: `SMS başına birim fiyat ${(SITE.pricePerSmsKurus / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2 })} TL'dir. Mini, Standart ve Premium paketlerle ihtiyacınıza uygun adedi seçebilirsiniz.`,
  },
  {
    q: "SMS API ile kendi yazılımımdan gönderim yapabilir miyim?",
    a: "Evet. REST tabanlı SMS API ile PHP, Python ve JavaScript örnekleri üzerinden kendi sisteminize entegre edebilir, rapor callback (DLR) adresi tanımlayabilirsiniz.",
  },
  {
    q: "Bayi SMS paneli ne işe yarar?",
    a: "Bayi paneliyle kendi müşterilerinize alt hesap açabilir, kredi tanımlayabilir, gönderimleri ve işlem geçmişini tek yerden yönetebilirsiniz.",
  },
  {
    q: "Zamanlanmış SMS gönderebilir miyim?",
    a: "Evet. Kampanyalarınızı ileri bir tarih ve saate planlayabilirsiniz. Gönderimler 10:00–22:00 saatleri arasında yapılır.",
  },
  {
    q: "Ticari SMS için alıcı izni gerekir mi?",
    a: "Evet. Türkiye'de ticari elektronik iletiler için alıcının onayı (İYS) gerekir. Gönderim yapacağınız listenin izinli olduğundan emin olmalısınız.",
  },
] as const;

export function buildJsonLd() {
  const org = {
    "@type": "Organization",
    "@id": `${SITE_URL}/#org`,
    name: SITE.name,
    url: SITE_URL,
    logo: `${SITE_URL}/favicon.svg`,
    email: SITE.email,
    sameAs: [SITE.telegramUrl],
    contactPoint: [
      {
        "@type": "ContactPoint",
        contactType: "customer support",
        telephone: SITE.whatsappNumber,
        availableLanguage: ["Turkish"],
      },
    ],
  };

  const website = {
    "@type": "WebSite",
    "@id": `${SITE_URL}/#website`,
    url: SITE_URL,
    name: SITE.name,
    inLanguage: "tr-TR",
    publisher: { "@id": `${SITE_URL}/#org` },
  };

  const products = PACKAGES.map((p) => ({
    "@type": "Product",
    name: `${p.name} - ${p.sms.toLocaleString("tr-TR")} Toplu SMS`,
    description: `${p.sms.toLocaleString("tr-TR")} adetlik toplu SMS kredisi.`,
    brand: { "@type": "Brand", name: SITE.name },
    offers: {
      "@type": "Offer",
      priceCurrency: "TRY",
      price: packagePriceTl(p.sms).toFixed(2),
      availability: "https://schema.org/InStock",
      url: `${SITE_URL}/#fiyatlar`,
    },
  }));

  const faq = {
    "@type": "FAQPage",
    mainEntity: FAQ.map((f) => ({
      "@type": "Question",
      name: f.q,
      acceptedAnswer: { "@type": "Answer", text: f.a },
    })),
  };

  return { "@context": "https://schema.org", "@graph": [org, website, ...products, faq] };
}
