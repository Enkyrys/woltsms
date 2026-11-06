"use client";
import { useState } from "react";
import Logo from "@/components/Logo";
import { SITE } from "@/lib/site";

// Yeni Üyelik Aç — başvuru admin onayından sonra aktifleşir.
const RULES = [
  { test: (p: string) => p.length >= 8, t: "8+ karakter" },
  { test: (p: string) => /[A-ZÇĞİÖŞÜ]/.test(p), t: "büyük harf" },
  { test: (p: string) => /[a-zçğıöşü]/.test(p), t: "küçük harf" },
  { test: (p: string) => /[0-9]/.test(p), t: "rakam" },
  { test: (p: string) => /[^A-Za-z0-9çÇğĞıIİöÖşŞüÜ]/.test(p), t: "özel karakter" },
];

export default function KayitPage() {
  const [f, setF] = useState({ name: "", username: "", phone: "", email: "", password: "", passwordConfirm: "", note: "", website: "" });
  const [accept, setAccept] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value });

  const rulesOk = RULES.every((r) => r.test(f.password));
  const usernameOk = /^[A-Za-z0-9._-]{3,32}$/.test(f.username.trim());

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErr("");
    if (f.name.trim().length < 2) return setErr("Ad soyad / firma adı girin.");
    if (!usernameOk) return setErr("Kullanıcı adı 3-32 karakter olmalı; harf, rakam, nokta, tire ve alt çizgi kullanılabilir.");
    if (f.phone.replace(/[^0-9]/g, "").length < 10) return setErr("Geçerli bir telefon numarası girin.");
    if (!rulesOk) return setErr("Şifre kuralları karşılanmıyor.");
    if (f.password !== f.passwordConfirm) return setErr("Şifreler birbiriyle eşleşmiyor.");
    if (!accept) return setErr("Devam etmek için koşulları onaylayın.");
    setBusy(true);
    const r = await fetch("/api/auth/register", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...f, accept }) });
    const j = await r.json().catch(() => ({ success: false, message: "Sunucu yanıtı okunamadı." }));
    setBusy(false);
    if (!j.success) return setErr(j.message || "Başvuru alınamadı.");
    setDone(j.data?.username || f.username.trim().toLowerCase());
  };

  const contact = (
    <div className="grid gap-2 text-[13px]">
      <a href={SITE.telegramUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 hover:border-[#0FB5A0]">
        <span aria-hidden>✈️</span><span className="font-semibold">Telegram</span><span className="ml-auto text-slate-500">{SITE.telegramHandle}</span>
      </a>
      <a href={SITE.whatsappUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 hover:border-[#0FB5A0]">
        <span aria-hidden>💬</span><span className="font-semibold">WhatsApp</span><span className="ml-auto text-slate-500">{SITE.whatsappNumber}</span>
      </a>
      <a href={`mailto:${SITE.email}?subject=${encodeURIComponent("WOLTSMS üyelik")}`} className="flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2.5 hover:border-[#0FB5A0]">
        <span aria-hidden>✉️</span><span className="font-semibold">E-posta</span><span className="ml-auto text-slate-500 truncate">{SITE.email}</span>
      </a>
    </div>
  );

  return (
    <div className="min-h-screen px-4 py-10" style={{ background: "linear-gradient(180deg,#E6FAF7 0%,#F8FAFC 60%)" }}>
      <div className="max-w-[960px] mx-auto">
        <div className="flex items-center justify-between mb-6">
          <Logo href="/" />
          <a href="/" className="text-[13px] font-semibold text-[#0A8F7E]">← Ana sayfa</a>
        </div>
        <div className="grid md:grid-cols-[1fr_300px] gap-6">
          <div className="card !p-7">
            {done ? (
              <div className="text-center py-6">
                <div className="w-14 h-14 mx-auto rounded-full bg-[#E6FAF7] text-[#0FB5A0] grid place-items-center text-2xl font-extrabold">✓</div>
                <h1 className="text-xl font-extrabold mt-4">Başvurunuz alındı</h1>
                <p className="text-sm text-slate-600 mt-2 max-w-md mx-auto">
                  Kullanıcı adınız: <b>{done}</b>. Üyeliğiniz yönetici tarafından onaylanınca bu kullanıcı adı ve belirlediğiniz şifreyle giriş yapabilirsiniz.
                </p>
                <p className="text-[13px] text-slate-500 mt-4 mb-3">Onayı hızlandırmak için bize yazabilirsiniz:</p>
                <div className="max-w-sm mx-auto text-left">{contact}</div>
              </div>
            ) : (
              <form onSubmit={submit} noValidate>
                <h1 className="text-xl font-extrabold mb-1">Yeni Üyelik Aç</h1>
                <p className="text-sm text-slate-500 mb-6">Bilgilerinizi doldurun; üyeliğiniz onaylandıktan sonra panele giriş yapabilirsiniz.</p>
                <div className="grid sm:grid-cols-2 gap-x-4">
                  <div className="mb-4 sm:col-span-2">
                    <label className="label" htmlFor="ad">Ad soyad / Firma adı</label>
                    <input id="ad" className="input" value={f.name} onChange={set("name")} maxLength={120} autoComplete="name" />
                  </div>
                  <div className="mb-4">
                    <label className="label" htmlFor="ku">Kullanıcı adı</label>
                    <input id="ku" className="input" value={f.username} onChange={set("username")} maxLength={32} autoComplete="username" placeholder="örn. kadikoy.bayi" />
                    {f.username && !usernameOk && <div className="text-[11px] text-red-600 mt-1">3-32 karakter; harf, rakam, . - _</div>}
                  </div>
                  <div className="mb-4">
                    <label className="label" htmlFor="tel">Telefon (WhatsApp)</label>
                    <input id="tel" className="input" value={f.phone} onChange={set("phone")} maxLength={20} inputMode="tel" autoComplete="tel" placeholder="05xx xxx xx xx" />
                  </div>
                  <div className="mb-4 sm:col-span-2">
                    <label className="label" htmlFor="ep">E-posta (isteğe bağlı)</label>
                    <input id="ep" className="input" type="email" value={f.email} onChange={set("email")} autoComplete="email" />
                  </div>
                  <div className="mb-1">
                    <label className="label" htmlFor="pw">Şifre</label>
                    <input id="pw" className="input" type={showPw ? "text" : "password"} value={f.password} onChange={set("password")} autoComplete="new-password" />
                  </div>
                  <div className="mb-1">
                    <label className="label" htmlFor="pw2">Şifre (tekrar)</label>
                    <input id="pw2" className="input" type={showPw ? "text" : "password"} value={f.passwordConfirm} onChange={set("passwordConfirm")} autoComplete="new-password" />
                  </div>
                  <div className="sm:col-span-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] mb-4">
                    {RULES.map((r) => <span key={r.t} className={r.test(f.password) ? "text-green-700" : "text-slate-400"}>{r.test(f.password) ? "✓" : "○"} {r.t}</span>)}
                    {f.passwordConfirm && <span className={f.password === f.passwordConfirm ? "text-green-700" : "text-red-600"}>{f.password === f.passwordConfirm ? "✓ eşleşiyor" : "✕ eşleşmiyor"}</span>}
                    <button type="button" className="ml-auto text-[#0A8F7E] font-semibold" onClick={() => setShowPw(!showPw)}>{showPw ? "Gizle" : "Göster"}</button>
                  </div>
                  <div className="mb-4 sm:col-span-2">
                    <label className="label" htmlFor="not">Not (isteğe bağlı)</label>
                    <textarea id="not" className="input resize-y" rows={2} maxLength={500} value={f.note} onChange={set("note")} placeholder="Aylık tahmini SMS adedi, firma bilgisi vb." />
                  </div>
                  {/* bal küpü: ekranda görünmez, botlar doldurur */}
                  <div aria-hidden className="absolute -left-[9999px] w-px h-px overflow-hidden">
                    <label htmlFor="website">Web sitesi</label>
                    <input id="website" tabIndex={-1} autoComplete="off" value={f.website} onChange={set("website")} />
                  </div>
                </div>
                <label className="flex items-start gap-2 text-[13px] mb-4 cursor-pointer">
                  <input type="checkbox" className="w-4 h-4 mt-0.5 accent-[#0FB5A0]" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
                  <span>Bilgilerimin üyelik başvurusu için işlenmesini ve yalnızca izinli alıcılara SMS göndereceğimi kabul ediyorum.</span>
                </label>
                {err && <div className="text-[13px] text-red-700 bg-red-50 rounded-lg p-2.5 mb-3" role="alert">{err}</div>}
                <button disabled={busy} className="btn-primary w-full py-3 disabled:opacity-50">{busy ? "Gönderiliyor…" : "Üyelik başvurusu gönder"}</button>
                <p className="text-center text-[13px] text-slate-500 mt-4">Zaten üye misiniz? <a href="/login" className="text-[#0A8F7E] font-semibold">Giriş yapın</a></p>
              </form>
            )}
          </div>
          <aside className="card !p-5 h-fit">
            <div className="font-bold text-sm mb-1">İletişim</div>
            <p className="text-[12px] text-slate-500 mb-3">Sorularınız, paket ve özel fiyat talepleriniz için:</p>
            {contact}
          </aside>
        </div>
      </div>
    </div>
  );
}
