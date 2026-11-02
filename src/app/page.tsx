import type { Metadata } from "next";
import Logo from "@/components/Logo";
import { SITE, PACKAGES, packagePriceTl, tl } from "@/lib/site";

export const metadata: Metadata = {
  title: "WOLTSMS - Toplu SMS Paketleri",
  description: `Toplu SMS paketleri SMS başına ₺${tl(SITE.pricePerSmsKurus / 100, 2)}. Havale ve kripto ile yükleme, API entegrasyonu, teslim raporları.`,
};

const FEATURES = [
  { t: "Havale & Kripto", d: "Kredi yüklemeyi havale veya kripto ile yapın, onaylanınca bakiyeniz hesabınıza geçer." },
  { t: "Teslim Raporları", d: "Her mesajın durumunu panelden izleyin; iletildi, bekliyor ve başarısız kayıtlarını görün." },
  { t: "API Entegrasyonu", d: "Kendi yazılımınızdan SMS göndermek için API anahtarı ve dokümantasyon." },
  { t: "Toplu Gönderim", d: "Rehber ve liste yükleyerek binlerce numaraya tek siparişte gönderin." },
];

const STEPS = [
  { n: "1", t: "Paketinizi seçin", d: "İhtiyacınıza uygun paketi belirleyin." },
  { n: "2", t: "Bizimle iletişime geçin", d: "Telegram veya WhatsApp üzerinden ulaşın, hesabınız açılsın ve bakiyeniz yüklensin." },
  { n: "3", t: "Panelden gönderin", d: "Giriş yapın, mesajınızı yazın ve gönderin." },
];

export default function Home() {
  const unit = tl(SITE.pricePerSmsKurus / 100, 2);
  const mailUrl = (subject: string) => `mailto:${SITE.email}?subject=${encodeURIComponent(subject)}`;

  return (
    <div className="min-h-screen bg-white text-slate-800">
      {/* üst bant */}
      <div className="bg-[#0FB5A0] text-white text-center text-[13px] py-2 px-4">
        Toplu SMS&apos;te SMS başına sadece <b>₺{unit}</b> — Telegram veya WhatsApp kanalımızdan hemen ulaşın.
      </div>

      {/* menü */}
      <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-slate-100">
        <div className="max-w-[1200px] mx-auto flex items-center justify-between px-4 lg:px-8 h-16">
          <Logo href="/" />
          <nav className="hidden md:flex items-center gap-7 text-[14px] font-semibold text-slate-600">
            <a href="#paketler" className="hover:text-[#0A8F7E]">Paketler</a>
            <a href="#ozellikler" className="hover:text-[#0A8F7E]">Özellikler</a>
            <a href="#nasil" className="hover:text-[#0A8F7E]">Nasıl Çalışır</a>
            <a href="#iletisim" className="hover:text-[#0A8F7E]">İletişim</a>
          </nav>
          <a href="/login" className="btn-primary inline-block px-5 py-2 text-sm">Giriş Yap</a>
        </div>
      </header>

      {/* banner */}
      <section className="relative overflow-hidden bg-gradient-to-br from-[#0FB5A0] via-[#0CA38F] to-[#0A8F7E] text-white">
        <div className="absolute -right-24 -top-24 w-[420px] h-[420px] rounded-full bg-white/10" aria-hidden />
        <div className="absolute -left-16 -bottom-28 w-[320px] h-[320px] rounded-full bg-white/10" aria-hidden />
        <div className="relative max-w-[1200px] mx-auto px-4 lg:px-8 py-16 md:py-24 grid md:grid-cols-2 gap-10 items-center">
          <div>
            <div className="inline-block text-[12px] font-bold tracking-wide bg-white/15 rounded-full px-3 py-1 mb-4">BAYİ SMS PANELİ</div>
            <h1 className="text-4xl md:text-5xl font-extrabold leading-tight">
              Toplu SMS&apos;te <span className="text-[#d9fff9]">uygun fiyat</span>, kolay yönetim
            </h1>
            <p className="mt-4 text-[17px] text-white/90 max-w-[520px]">
              SMS başına <b>₺{unit}</b>. Paketini seç, bakiyeni yükle, panelden veya API ile saniyeler içinde gönder.
            </p>
            <div className="mt-7 flex flex-wrap gap-3">
              <a href="/login" className="bg-white text-[#0A8F7E] font-bold rounded-lg px-6 py-3 hover:bg-[#e6faf7] transition">Giriş Yap</a>
              <a href="#paketler" className="border-2 border-white/80 font-bold rounded-lg px-6 py-3 hover:bg-white/10 transition">Paketleri İncele</a>
            </div>
          </div>
          <div className="bg-white/10 border border-white/20 rounded-2xl p-6 backdrop-blur">
            <div className="text-[13px] font-semibold text-white/80 mb-3">Fiyat örneği</div>
            {PACKAGES.map((p) => (
              <div key={p.name} className="flex items-center justify-between py-3 border-b border-white/15 last:border-0">
                <div>
                  <div className="font-bold">{p.name}</div>
                  <div className="text-[13px] text-white/75">{tl(p.sms)} SMS</div>
                </div>
                <div className="text-2xl font-extrabold">₺{tl(packagePriceTl(p.sms))}</div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* paketler */}
      <section id="paketler" className="max-w-[1200px] mx-auto px-4 lg:px-8 py-16 scroll-mt-16">
        <h2 className="text-3xl font-extrabold text-center">SMS Yükleme Paketleri</h2>
        <p className="text-center text-slate-500 mt-2">Tüm paketlerde SMS başına <b className="text-[#0A8F7E]">₺{unit}</b></p>
        <div className="grid md:grid-cols-3 gap-6 mt-10">
          {PACKAGES.map((p) => (
            <div
              key={p.name}
              className={`rounded-2xl border p-7 flex flex-col text-center ${p.featured ? "border-[#0FB5A0] shadow-xl shadow-[#0FB5A0]/15 md:-translate-y-2" : "border-slate-200 shadow-sm"}`}
            >
              {p.featured && <div className="self-center -mt-11 mb-3 bg-[#0FB5A0] text-white text-[12px] font-bold rounded-full px-3 py-1">En Çok Tercih Edilen</div>}
              <h3 className="text-lg font-bold">{p.name}</h3>
              <div className="mt-5 text-5xl font-extrabold text-slate-900">₺{tl(packagePriceTl(p.sms))}</div>
              <div className="mt-1 text-[15px] text-slate-500">{tl(p.sms)} SMS</div>
              <a
                href={SITE.telegramUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="btn-primary mt-6 py-3 text-[15px]"
              >
                Satın Al
              </a>
              <ul className="mt-6 pt-6 border-t border-slate-100 text-left text-[14px] space-y-2.5 text-slate-600">
                {[`₺${unit} / SMS`, "Havale & kripto ile yükleme", "Kullanıcı dostu yönetim paneli", "Teslim raporları", "API erişimi"].map((f) => (
                  <li key={f} className="flex gap-2"><span className="text-[#0FB5A0] font-bold">✓</span>{f}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
        <p className="text-center text-[13px] text-slate-400 mt-8">
          Farklı adetler için iletişime geçin; paket dışı talepler için özel fiyat verilebilir.
        </p>
      </section>

      {/* özellikler */}
      <section id="ozellikler" className="bg-slate-50 py-16 scroll-mt-16">
        <div className="max-w-[1200px] mx-auto px-4 lg:px-8">
          <h2 className="text-3xl font-extrabold text-center">Neden WOLTSMS?</h2>
          <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5 mt-10">
            {FEATURES.map((f) => (
              <div key={f.t} className="bg-white rounded-xl border border-slate-100 p-6 shadow-sm">
                <div className="w-10 h-10 rounded-lg bg-[#e6faf7] text-[#0FB5A0] grid place-items-center font-extrabold mb-3">✓</div>
                <div className="font-bold">{f.t}</div>
                <p className="text-[14px] text-slate-500 mt-1.5">{f.d}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* nasıl çalışır */}
      <section id="nasil" className="max-w-[1200px] mx-auto px-4 lg:px-8 py-16 scroll-mt-16">
        <h2 className="text-3xl font-extrabold text-center">Nasıl Çalışır?</h2>
        <div className="grid md:grid-cols-3 gap-6 mt-10">
          {STEPS.map((s) => (
            <div key={s.n} className="text-center">
              <div className="w-12 h-12 mx-auto rounded-full bg-[#0FB5A0] text-white grid place-items-center text-xl font-extrabold">{s.n}</div>
              <div className="font-bold mt-4">{s.t}</div>
              <p className="text-[14px] text-slate-500 mt-1">{s.d}</p>
            </div>
          ))}
        </div>
      </section>

      {/* iletişim */}
      <section id="iletisim" className="bg-gradient-to-br from-[#0FB5A0] to-[#0A8F7E] text-white py-16 scroll-mt-16">
        <div className="max-w-[900px] mx-auto px-4 lg:px-8 text-center">
          <h2 className="text-3xl font-extrabold">İletişim</h2>
          <p className="mt-2 text-white/85">Paket satın almak veya hesap açtırmak için bize yazın.</p>
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5 mt-8 text-left">
            <a href={SITE.telegramUrl} target="_blank" rel="noopener noreferrer" className="bg-white text-slate-800 rounded-xl p-6 hover:shadow-xl transition block">
              <div className="text-[12px] font-bold text-[#0FB5A0] tracking-wide">TELEGRAM KANALI</div>
              <div className="text-xl font-extrabold mt-1">{SITE.telegramHandle}</div>
              <div className="text-[13px] text-slate-500 mt-1">Duyurular, destek ve sipariş için</div>
            </a>
            <a href={SITE.whatsappUrl} target="_blank" rel="noopener noreferrer" className="bg-white text-slate-800 rounded-xl p-6 hover:shadow-xl transition block">
              <div className="text-[12px] font-bold text-[#0FB5A0] tracking-wide">WHATSAPP KANALI</div>
              <div className="text-xl font-extrabold mt-1">WOLTSMS</div>
              <div className="text-[13px] text-slate-500 mt-1">Güncel haberler için kanalımıza katılın</div>
            </a>
            {SITE.email && (
              <a href={mailUrl("WOLTSMS bilgi talebi")} className="bg-white text-slate-800 rounded-xl p-6 hover:shadow-xl transition block">
                <div className="text-[12px] font-bold text-[#0FB5A0] tracking-wide">E-POSTA</div>
                <div className="text-xl font-extrabold mt-1 break-all">{SITE.email}</div>
                <div className="text-[13px] text-slate-500 mt-1">Teklif ve kurumsal talepler için</div>
              </a>
            )}
          </div>
          <a href="/login" className="inline-block mt-8 bg-white text-[#0A8F7E] font-bold rounded-lg px-7 py-3 hover:bg-[#e6faf7] transition">Zaten hesabınız var mı? Giriş Yap</a>
        </div>
      </section>

      <footer className="py-6 text-center text-[13px] text-slate-400">
        © {new Date().getFullYear()} {SITE.name}. Tüm hakları saklıdır.
      </footer>
    </div>
  );
}
