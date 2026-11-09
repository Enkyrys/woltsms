import Link from "next/link";
import Logo from "@/components/Logo";
import { SITE, PACKAGES, packagePriceTl, tl } from "@/lib/site";
import { FAQ, buildJsonLd } from "@/lib/seo";

// Herkese açık ana sayfa (SEO landing). Önceden /panel/dashboard'a yönlendiriyordu;
// yönlendirme Google'ın ana sayfayı indekslemesini engellerdi.
const FEATURES = [
  { t: "Toplu SMS Gönderimi", d: "Numaraları yapıştırın ya da Excel ile yükleyin, binlerce kişiye tek seferde SMS gönderin." },
  { t: "Bayi SMS Paneli", d: "Alt hesap açın, müşterilerinize kredi tanımlayın, tüm gönderimleri tek panelden yönetin." },
  { t: "SMS API Entegrasyonu", d: "REST API ile PHP, Python ve JavaScript örnekleriyle kendi yazılımınızdan SMS gönderin." },
  { t: "Zamanlanmış SMS", d: "Kampanyalarınızı ileri tarih ve saate planlayın, otomatik gönderilsin." },
  { t: "SMS Kısa URL", d: "Mesajlarınızdaki linkleri kısaltın, tıklama sayılarını takip edin." },
  { t: "Anlık Raporlama", d: "İşlem geçmişi ve iletim raporlarıyla gönderimlerinizi anında görün." },
] as const;

export default function Home() {
  const jsonLd = JSON.stringify(buildJsonLd()).replace(/</g, "\\u003c");

  return (
    <main className="min-h-screen" style={{ background: "linear-gradient(180deg,#E6FAF7 0%,#F8FAFC 40%)" }}>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: jsonLd }} />

      <header className="max-w-6xl mx-auto flex items-center justify-between px-4 py-4">
        <Logo href="/" />
        <nav aria-label="Ana menü" className="flex items-center gap-4 text-sm font-semibold">
          <a href="#ozellikler" className="hidden sm:block text-slate-600 hover:text-[#0A8F7E]">Özellikler</a>
          <a href="#fiyatlar" className="hidden sm:block text-slate-600 hover:text-[#0A8F7E]">Fiyatlar</a>
          <a href="#sss" className="hidden sm:block text-slate-600 hover:text-[#0A8F7E]">SSS</a>
          <Link href="/login" className="btn-outline px-4 py-2">Giriş</Link>
        </nav>
      </header>

      <section className="max-w-4xl mx-auto text-center px-4 pt-12 pb-16">
        <h1 className="text-3xl sm:text-5xl font-extrabold leading-tight text-slate-900">
          Toplu SMS Gönder: Ucuz Paketler, Bayi SMS Paneli ve SMS API
        </h1>
        <p className="mt-5 text-slate-600 text-lg">
          WOLTSMS ile SMS başına <strong>{tl(SITE.pricePerSmsKurus / 100, 2)} TL</strong>’den başlayan fiyatlarla
          reklam, bilgilendirme ve doğrulama (OTP) SMS’lerinizi hızlıca gönderin.
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/kayit" className="btn-primary px-6 py-3">Hemen Üye Ol</Link>
          <a href={SITE.whatsappUrl} className="btn-green px-6 py-3" target="_blank" rel="noopener noreferrer">WhatsApp: {SITE.whatsappNumber}</a>
          <a href={SITE.telegramUrl} className="btn-outline px-6 py-3" target="_blank" rel="noopener noreferrer">Telegram: {SITE.telegramHandle}</a>
        </div>
      </section>

      <section id="ozellikler" className="max-w-6xl mx-auto px-4 pb-16">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-8">Toplu SMS Paneli Özellikleri</h2>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((f) => (
            <article key={f.t} className="card !p-6">
              <h3 className="font-bold text-lg text-[#0A8F7E] mb-2">{f.t}</h3>
              <p className="text-sm text-slate-600">{f.d}</p>
            </article>
          ))}
        </div>
      </section>

      <section id="fiyatlar" className="max-w-6xl mx-auto px-4 pb-16">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-2">Toplu SMS Paketleri ve Fiyatları</h2>
        <p className="text-center text-slate-500 mb-8">Birim fiyat: {tl(SITE.pricePerSmsKurus / 100, 2)} TL / SMS</p>
        <div className="grid gap-4 md:grid-cols-3">
          {PACKAGES.map((p) => (
            <div key={p.name} className={`card !p-6 text-center ${p.featured ? "ring-2 ring-[#0FB5A0]" : ""}`}>
              <h3 className="font-bold text-lg">{p.name}</h3>
              <div className="text-3xl font-extrabold text-[#0FB5A0] my-3">{tl(p.sms)} SMS</div>
              <div className="text-slate-600 mb-4">{tl(packagePriceTl(p.sms))} TL</div>
              <Link href="/kayit" className="btn-primary px-5 py-2 inline-block">Satın Al</Link>
            </div>
          ))}
        </div>
      </section>

      <section id="sss" className="max-w-3xl mx-auto px-4 pb-16">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-8">Sık Sorulan Sorular</h2>
        <div className="space-y-3">
          {FAQ.map((f) => (
            <details key={f.q} className="card !p-4">
              <summary className="font-semibold cursor-pointer">{f.q}</summary>
              <p className="mt-2 text-sm text-slate-600">{f.a}</p>
            </details>
          ))}
        </div>
      </section>

      <section id="iletisim" className="max-w-3xl mx-auto px-4 pb-16">
        <h2 className="text-2xl sm:text-3xl font-extrabold text-center mb-2">İletişim</h2>
        <p className="text-center text-slate-500 mb-8">Fiyat teklifi, bayilik ve destek için bize yazın.</p>
        <div className="grid gap-4 sm:grid-cols-2">
          <a href={SITE.whatsappUrl} target="_blank" rel="noopener noreferrer" className="card !p-6 text-center hover:ring-2 hover:ring-[#22c55e]">
            <h3 className="font-bold text-lg mb-1">WhatsApp</h3>
            <p className="text-slate-600">{SITE.whatsappNumber}</p>
          </a>
          <a href={SITE.telegramUrl} target="_blank" rel="noopener noreferrer" className="card !p-6 text-center hover:ring-2 hover:ring-[#0FB5A0]">
            <h3 className="font-bold text-lg mb-1">Telegram</h3>
            <p className="text-slate-600">{SITE.telegramHandle}</p>
          </a>
        </div>
      </section>

      <footer className="border-t border-slate-200 py-8 text-center text-sm text-slate-500">
        <p>© {new Date().getFullYear()} {SITE.name} · Toplu SMS ve Bayi SMS Paneli</p>
        <p className="mt-1">
          <a href={SITE.telegramUrl} rel="noopener noreferrer">Telegram {SITE.telegramHandle}</a> · <a href={SITE.whatsappUrl} rel="noopener noreferrer">WhatsApp {SITE.whatsappNumber}</a> · <a href={`mailto:${SITE.email}`}>{SITE.email}</a>
        </p>
      </footer>

      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
        <a href={SITE.whatsappUrl} target="_blank" rel="noopener noreferrer" aria-label="WhatsApp ile yazın" className="btn-green px-4 py-3 shadow-lg text-sm">WhatsApp</a>
        <a href={SITE.telegramUrl} target="_blank" rel="noopener noreferrer" aria-label="Telegram ile yazın" className="btn-primary px-4 py-3 shadow-lg text-sm">Telegram</a>
      </div>
    </main>
  );
}
