"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import Logo from "@/components/Logo";

export default function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true); setErr("");
    const r = await fetch("/api/auth/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ username, password }) });
    const j = await r.json();
    setLoading(false);
    if (!j.success) { setErr(j.message); return; }
    router.push("/panel/dashboard");
  };

  return (
    <div className="min-h-screen grid place-items-center px-4" style={{ background: "linear-gradient(180deg,#E6FAF7 0%,#F8FAFC 60%)" }}>
      <div className="w-full max-w-md card !p-8">
        <div className="flex justify-center mb-6"><Logo /></div>
        <h1 className="text-center font-extrabold text-xl mb-1">WOLTSMS Panel Girişi</h1>
        <p className="text-center text-sm text-slate-500 mb-6">Bayi SMS Paneli · Havale & Kripto ile yükleme</p>
        <form onSubmit={submit}>
          <label className="label">Kullanıcı Adı</label>
          <input className="input mb-4" value={username} onChange={(e) => setUsername(e.target.value)} placeholder="Kullanıcı adı" />
          <label className="label">Şifre</label>
          <input className="input mb-2" type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" />
          {err && <div className="text-red-600 text-sm mb-2">{err}</div>}
          <button disabled={loading} className="btn-primary w-full py-3 mt-2">{loading ? "Giriş yapılıyor..." : "Giriş Yap"}</button>
        </form>
        <p className="text-center text-[13px] text-slate-500 mt-5">Hesabınız yok mu? <a href="/kayit" className="text-[#0A8F7E] font-semibold">Yeni Üyelik Aç</a></p>
      </div>
    </div>
  );
}
