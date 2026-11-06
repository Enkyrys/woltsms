"use client";
import { useEffect, useState } from "react";
import { PageTitle, Card } from "@/components/ui";

// Hesabım: kullanıcının kendi bilgileri ve şifre değiştirme (#sifre)
type Account = {
  username: string; name: string; phone: string; email: string; roleName: string | null;
  lastLoginAt: string | null; createdAt: string | null; passwordChangedAt: string | null;
};

const RULES = [
  { test: (p: string) => p.length >= 8, t: "En az 8 karakter" },
  { test: (p: string) => /[A-ZÇĞİÖŞÜ]/.test(p), t: "En az 1 büyük harf" },
  { test: (p: string) => /[a-zçğıöşü]/.test(p), t: "En az 1 küçük harf" },
  { test: (p: string) => /[0-9]/.test(p), t: "En az 1 rakam" },
  { test: (p: string) => /[^A-Za-z0-9çÇğĞıIİöÖşŞüÜ]/.test(p), t: "En az 1 özel karakter" },
];
const fmt = (v: string | null) => (v ? new Date(v).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");

function PwInput({ id, label, value, onChange, show, autoComplete }: { id: string; label: string; value: string; onChange: (v: string) => void; show: boolean; autoComplete: string }) {
  return (
    <div className="mb-4">
      <label className="label" htmlFor={id}>{label}</label>
      <input id={id} className="input" type={show ? "text" : "password"} autoComplete={autoComplete} value={value} onChange={(e) => onChange(e.target.value)} />
    </div>
  );
}

export default function HesabimPage() {
  const [acc, setAcc] = useState<Account | null>(null);
  const [info, setInfo] = useState({ name: "", phone: "", email: "" });
  const [infoMsg, setInfoMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [savingInfo, setSavingInfo] = useState(false);

  const [pw, setPw] = useState({ current: "", next: "", confirm: "" });
  const [showPw, setShowPw] = useState(false);
  const [signOutOthers, setSignOutOthers] = useState(true);
  const [pwMsg, setPwMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [savingPw, setSavingPw] = useState(false);

  const load = () => fetch("/api/panel/account").then(async (r) => {
    const j = await r.json().catch(() => ({}));
    if (j.success) { setAcc(j.data); setInfo({ name: j.data.name || "", phone: j.data.phone || "", email: j.data.email || "" }); }
  });
  useEffect(() => {
    load();
    if (window.location.hash === "#sifre") setTimeout(() => document.getElementById("sifre")?.scrollIntoView({ behavior: "smooth" }), 300);
  }, []);

  const saveInfo = async () => {
    setInfoMsg(null);
    if (!info.name.trim()) { setInfoMsg({ ok: false, t: "İsim boş olamaz." }); return; }
    setSavingInfo(true);
    const r = await fetch("/api/panel/account", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(info) });
    const j = await r.json().catch(() => ({ success: false, message: "Sunucu yanıtı okunamadı." }));
    setSavingInfo(false);
    setInfoMsg({ ok: !!j.success, t: j.message });
    if (j.success) load();
  };

  const rulesOk = RULES.every((r) => r.test(pw.next));
  const match = pw.next.length > 0 && pw.next === pw.confirm;
  const canChange = pw.current.length > 0 && rulesOk && match && pw.next !== pw.current;

  const changePw = async () => {
    setPwMsg(null);
    if (!canChange) return;
    setSavingPw(true);
    const r = await fetch("/api/panel/account/password", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ currentPassword: pw.current, newPassword: pw.next, confirmPassword: pw.confirm, signOutOthers }),
    });
    const j = await r.json().catch(() => ({ success: false, message: "Sunucu yanıtı okunamadı." }));
    setSavingPw(false);
    setPwMsg({ ok: !!j.success, t: j.message });
    if (j.success) { setPw({ current: "", next: "", confirm: "" }); load(); }
  };

  return (
    <div className="max-w-3xl">
      <PageTitle>Hesabım</PageTitle>

      <Card className="mb-6">
        <h2 className="font-bold text-[15px] mb-1">Bilgilerim</h2>
        <p className="text-[12px] text-slate-500 mb-4">
          Kullanıcı adı: <b>@{acc?.username ?? "…"}</b>{acc?.roleName ? <> · Rol: <b>{acc.roleName}</b></> : null} · Son giriş: {fmt(acc?.lastLoginAt ?? null)}
        </p>
        <div className="grid sm:grid-cols-2 gap-x-4">
          <div className="mb-4">
            <label className="label" htmlFor="ad">İsim</label>
            <input id="ad" className="input" value={info.name} maxLength={120} onChange={(e) => setInfo({ ...info, name: e.target.value })} />
          </div>
          <div className="mb-4">
            <label className="label" htmlFor="tel">Telefon</label>
            <input id="tel" className="input" value={info.phone} maxLength={30} onChange={(e) => setInfo({ ...info, phone: e.target.value })} placeholder="(5__) ___-____" />
          </div>
          <div className="mb-4 sm:col-span-2">
            <label className="label" htmlFor="eposta">E-posta (isteğe bağlı)</label>
            <input id="eposta" className="input" type="email" value={info.email} onChange={(e) => setInfo({ ...info, email: e.target.value })} placeholder="ornek@firma.com" />
          </div>
        </div>
        <p className="text-[11px] text-slate-500 mb-3">Kullanıcı adınız ve rolünüz yalnızca yönetici tarafından değiştirilebilir. Girişte kullanıcı adınızı kullanmaya devam edersiniz.</p>
        {infoMsg && <div className={`text-[13px] rounded-lg p-2.5 mb-3 ${infoMsg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`} role="status">{infoMsg.t}</div>}
        <button onClick={saveInfo} disabled={savingInfo} className="btn-primary px-6 py-2.5 text-sm disabled:opacity-50">{savingInfo ? "Kaydediliyor…" : "Bilgilerimi kaydet"}</button>
      </Card>

      <Card id="sifre">
        <div className="flex items-start justify-between gap-3 mb-1">
          <h2 className="font-bold text-[15px]">Şifre Değiştir</h2>
          <button type="button" onClick={() => setShowPw(!showPw)} className="text-[12px] text-[#0FB5A0] font-semibold">{showPw ? "🙈 Şifreleri gizle" : "👁 Şifreleri göster"}</button>
        </div>
        <p className="text-[12px] text-slate-500 mb-4">Son şifre değişikliği: {fmt(acc?.passwordChangedAt ?? null)}</p>
        <PwInput id="pw-current" label="Mevcut şifre" value={pw.current} onChange={(v) => setPw({ ...pw, current: v })} show={showPw} autoComplete="current-password" />
        <PwInput id="pw-new" label="Yeni şifre" value={pw.next} onChange={(v) => setPw({ ...pw, next: v })} show={showPw} autoComplete="new-password" />
        <ul className="grid sm:grid-cols-2 gap-x-4 gap-y-0.5 text-[12px] -mt-2 mb-4">
          {RULES.map((r) => {
            const okR = r.test(pw.next);
            return <li key={r.t} className={okR ? "text-green-700" : "text-slate-400"}>{okR ? "✓" : "○"} {r.t}</li>;
          })}
          <li className={pw.next && pw.next === pw.current ? "text-red-600" : pw.next ? "text-green-700" : "text-slate-400"}>{pw.next && pw.next === pw.current ? "✕" : pw.next ? "✓" : "○"} Mevcut şifreden farklı</li>
        </ul>
        <PwInput id="pw-confirm" label="Yeni şifre (tekrar)" value={pw.confirm} onChange={(v) => setPw({ ...pw, confirm: v })} show={showPw} autoComplete="new-password" />
        {pw.confirm && !match && <div className="text-[12px] text-red-600 -mt-3 mb-3">Yeni şifreler eşleşmiyor.</div>}
        <label className="flex items-center gap-2 text-[13px] mb-4 cursor-pointer">
          <input type="checkbox" className="w-4 h-4 accent-[#0FB5A0]" checked={signOutOthers} onChange={(e) => setSignOutOthers(e.target.checked)} />
          Diğer cihazlardaki oturumlarımı kapat
        </label>
        {pwMsg && <div className={`text-[13px] rounded-lg p-2.5 mb-3 ${pwMsg.ok ? "bg-green-50 text-green-800" : "bg-red-50 text-red-700"}`} role="status">{pwMsg.t}</div>}
        <button onClick={changePw} disabled={!canChange || savingPw} className="btn-primary px-6 py-2.5 text-sm disabled:opacity-40">{savingPw ? "Değiştiriliyor…" : "Şifremi değiştir"}</button>
      </Card>
    </div>
  );
}
