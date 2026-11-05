"use client";
import { ReactNode, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import Logo from "./Logo";
import AdminOrderAlert from "./AdminOrderAlert";

type Me = {
  id: string; username: string; name: string; email: string;
  roleName: string | null; isAdmin: boolean; quota: string; unitPrice?: string;
  permissions: string[];
};

// Kalan bakiye / birim fiyat = gönderilebilecek SMS adedi
function smsCount(balance: string | number, unitPrice?: string | number): number | null {
  const price = Number(unitPrice);
  if (!isFinite(price) || price <= 0) return null;
  return Math.max(0, Math.floor(Number(balance) / price + 1e-9));
}

const MENU: { href: string; label: string; perm?: string; admin?: boolean }[] = [
  { href: "/panel/dashboard", label: "Dashboard" },
  { href: "/panel/rehber", label: "Rehber" },
  { href: "/panel/siparisler", label: "Kampanyalar" },
  { href: "/panel/zamanlanmis", label: "Zamanlanmış Kampanyalar", perm: "sms.send" },
  { href: "/panel/kullanicilar", label: "Kullanıcılar", perm: "users.manage" },
  { href: "/panel/roller", label: "Roller", perm: "roles.manage" },
  { href: "/panel/karaliste", label: "Karaliste" },
  { href: "/panel/kredi-yukle", label: "Kredi Yükle" },
  { href: "/panel/islem-gecmisi", label: "İşlem Geçmişi" },
  { href: "/panel/kisa-url", label: "Kısa URL'ler" },
  { href: "/panel/destek", label: "Destek Talepleri" },
];

const ADMIN_MENU = [
  { href: "/panel/admin/kullanici-aktivitesi", label: "Kullanıcı Aktivitesi" },
  { href: "/panel/admin/kredi-talepleri", label: "Kredi Talepleri" },
  { href: "/panel/admin/odeme-ayarlari", label: "Ödeme Ayarları" },
  { href: "/panel/admin/sistem", label: "Sistem & Sağlayıcı" },
];

const API_MENU = [
  { href: "/panel/api-anahtarlari", label: "API Anahtarları" },
  { href: "/panel/api-docs", label: "API Dokümantasyonu" },
];

export default function PanelShell({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [announcement, setAnnouncement] = useState("");
  const [pendingTopups, setPendingTopups] = useState(0);
  const [notifs, setNotifs] = useState<{ list: { id: string; title: string; message: string; created_at: string }[]; unread: number }>({ list: [], unread: 0 });
  const [showNotifs, setShowNotifs] = useState(false);
  const [showUser, setShowUser] = useState(false);
  const [dark, setDark] = useState(false);
  const [mobileMenu, setMobileMenu] = useState(false);
  const [lang, setLang] = useState("TR");
  const path = usePathname();
  const router = useRouter();

  useEffect(() => {
    fetch("/api/auth/me").then(async (r) => {
      if (!r.ok) { router.push("/login"); return; }
      const j = await r.json();
      setMe(j.data);
    });
    fetch("/api/panel/overview").then(async (r) => {
      if (r.ok) { const j = await r.json(); setAnnouncement(j.data?.announcement || ""); setPendingTopups(j.data?.pendingTopups || 0); }
    });
    fetch("/api/panel/notifications").then(async (r) => { if (r.ok) { const j = await r.json(); setNotifs(j.data); } });
  }, [router, path]);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", dark);
  }, [dark]);

  // kullanıcı aktivitesi: panel açıkken ~60 sn'de bir "buradayım" sinyali.
  // Sinyal ~3 dk gelmezse kullanıcı admin panelinde "pasif" görünür.
  useEffect(() => {
    if (!me) return;
    const beat = () => { void fetch("/api/panel/presence", { method: "POST", keepalive: true }).catch(() => undefined); };
    beat();
    const t = setInterval(beat, 60_000);
    const onVis = () => { if (document.visibilityState === "visible") beat(); };
    document.addEventListener("visibilitychange", onVis);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", onVis); };
  }, [me?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!showUser && !showNotifs) return;
    const onDown = (e: MouseEvent) => {
      if (!(e.target as HTMLElement).closest("[data-dropdown]")) { setShowUser(false); setShowNotifs(false); }
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") { setShowUser(false); setShowNotifs(false); } };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [showUser, showNotifs]);

  const initials = (me?.name || me?.username || "?").trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join("").toUpperCase();

  const can = (perm?: string) => {
    if (!perm) return true;
    if (!me) return false;
    if (me.isAdmin) return true;
    return me.permissions.includes("*") || me.permissions.includes(perm);
  };

  const logout = async () => {
    await fetch("/api/auth/logout", { method: "POST" });
    router.push("/login");
  };

  return (
    <div className="min-h-screen panel-bg" style={{ background: "var(--wolt-bg)" }}>
      {announcement && (
        <div className="w-full text-white text-center text-[13px] py-1.5 px-4" style={{ background: "#0FB5A0" }}>
          {announcement}
        </div>
      )}
      <div className="relative">
        <div className="header-gradient pixel-texture absolute inset-0 pointer-events-none" aria-hidden />
        <header className="relative z-30 max-w-[1400px] mx-auto flex items-center justify-between px-4 lg:px-8 pt-4 pb-6">
          <div className="flex items-center gap-3">
            <button className="lg:hidden text-2xl" onClick={() => setMobileMenu(!mobileMenu)}>☰</button>
            <Logo />
          </div>
          <div className="flex items-center gap-2">
            {me && (
              <a href="/panel/kredi-yukle" className="hidden sm:inline-flex items-center gap-1.5 text-[13px] font-bold px-3 py-1.5 rounded-full bg-[#E6FAF7] text-[#0A8F7E] border border-[#0FB5A0]/30 hover:bg-[#0FB5A0] hover:text-white transition">
                ₺ {Number(me.quota).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}
                {smsCount(me.quota, me.unitPrice) !== null && (
                  <span className="pl-1.5 ml-0.5 border-l border-[#0FB5A0]/30">{smsCount(me.quota, me.unitPrice)!.toLocaleString("tr-TR")} SMS</span>
                )}
              </a>
            )}
            <div className="relative" data-dropdown>
              <button onClick={() => { setShowNotifs(!showNotifs); setShowUser(false); }} className="w-9 h-9 grid place-items-center rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm relative">
                🔔
                {notifs.unread > 0 && <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] w-4.5 h-4.5 px-1 rounded-full">{notifs.unread}</span>}
              </button>
              {showNotifs && (
                <div className="absolute right-0 mt-2 w-80 card p-0 overflow-hidden z-50">
                  <div className="px-4 py-2.5 font-bold text-sm border-b flex justify-between items-center">
                    Bildirimler
                    <button className="text-[12px] text-[#0FB5A0]" onClick={async () => { await fetch("/api/panel/notifications", { method: "POST", body: JSON.stringify({ action: "read-all" }) }); setNotifs({ list: [], unread: 0 }); }}>Tümünü okundu işaretle</button>
                  </div>
                  <div className="max-h-80 overflow-auto">
                    {notifs.list.length === 0 && <div className="p-4 text-sm text-slate-500">Bildirim bulunamadı.</div>}
                    {notifs.list.map((n) => (
                      <div key={n.id} className="px-4 py-2.5 border-b text-[13px]">
                        <div className="font-semibold">{n.title}</div>
                        <div className="text-slate-500">{n.message}</div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
            {me?.isAdmin && <AdminOrderAlert />}
            <button onClick={() => setDark(!dark)} className="w-9 h-9 grid place-items-center rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm">
              {dark ? "🌙" : "☀️"}
            </button>
            <div className="relative" data-dropdown>
              <button
                onClick={() => { setShowUser(!showUser); setShowNotifs(false); }}
                aria-label="Profil menüsü"
                aria-expanded={showUser}
                className="w-9 h-9 grid place-items-center rounded-full bg-[#0FB5A0] text-white text-[13px] font-bold shadow-sm hover:bg-[#0A8F7E] transition"
              >
                {me ? initials : "👤"}
              </button>
              {showUser && me && (
                <div className="absolute right-0 mt-2 w-60 card p-4 z-50">
                  <div className="font-bold text-sm">{me.name}</div>
                  <div className="text-[12px] text-slate-500">@{me.username} · {me.roleName || "Kullanıcı"}</div>
                  <div className="text-[12px] text-slate-500 mt-1">Bakiye: ₺ {Number(me.quota).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</div>
                  {smsCount(me.quota, me.unitPrice) !== null && (
                    <>
                      <div className="text-[12px] text-slate-500">Kalan SMS: <b className="text-[#0A8F7E]">{smsCount(me.quota, me.unitPrice)!.toLocaleString("tr-TR")} adet</b></div>
                      <div className="text-[11px] text-slate-400">Birim fiyat: ₺ {Number(me.unitPrice).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 4 })}</div>
                    </>
                  )}
                  <button onClick={logout} className="btn-outline w-full mt-3 py-2 text-sm">Çıkış Yap</button>
                </div>
              )}
            </div>
          </div>
        </header>
      </div>

      <div className="max-w-[1400px] mx-auto px-4 lg:px-8 pb-16 flex gap-8">
        {/* Sidebar */}
        <aside className={`w-[210px] shrink-0 ${mobileMenu ? "fixed inset-y-0 left-0 z-40 bg-white dark:bg-slate-900 p-4 pt-16 shadow-2xl block" : "hidden lg:block"}`}>
          <a href="/panel/dashboard" className="btn-primary block text-center text-[13px] py-2.5 px-4 mb-5">Yeni Sms Gönder</a>
          <div className="mb-2">
            <div className="flex items-center justify-between text-[14px] font-bold text-slate-800 dark:text-white px-1 mb-2">
              <span className="flex items-center gap-2"><span className="w-6 h-6 grid place-items-center rounded-full border border-slate-300 text-[12px]">🧭</span> Panel</span>
              <span className="text-slate-400">⌄</span>
            </div>
            <nav className="border-l border-slate-200 dark:border-slate-700 ml-2">
              {MENU.filter((m) => can(m.perm)).map((m) => (
                <a key={m.href} href={m.href} className={`menu-item ${path === m.href ? "active" : ""}`}>
                  {m.label}
                  {m.href === "/panel/kredi-yukle" && pendingTopups > 0 && !me?.isAdmin && <span className="ml-1 text-[11px] bg-yellow-100 text-yellow-800 px-1.5 rounded-full">{pendingTopups}</span>}
                </a>
              ))}
              {me?.isAdmin && (
                <>
                  <div className="px-3 pt-3 pb-1 text-[11px] font-bold uppercase text-slate-400">Yönetim</div>
                  {ADMIN_MENU.map((m) => (
                    <a key={m.href} href={m.href} className={`menu-item ${path === m.href ? "active" : ""}`}>
                      {m.label}
                      {m.href.includes("kredi-talepleri") && pendingTopups > 0 && <span className="ml-1 text-[11px] bg-red-100 text-red-700 px-1.5 rounded-full">{pendingTopups}</span>}
                    </a>
                  ))}
                </>
              )}
              <div className="px-3 pt-3 pb-1 text-[11px] font-bold uppercase text-slate-400">API</div>
              {API_MENU.map((m) => (
                <a key={m.href} href={m.href} className={`menu-item ${path === m.href ? "active" : ""}`}>{m.label}</a>
              ))}
            </nav>
          </div>
          <div className="mt-6 relative">
            <button onClick={() => setLang(lang === "TR" ? "EN" : "TR")} className="flex items-center gap-2 border border-slate-200 dark:border-slate-700 rounded-lg px-3 py-2 text-sm bg-white dark:bg-slate-800 w-[110px]">
              <span>{lang === "TR" ? "🇹🇷" : "🇬🇧"}</span> {lang} <span className="ml-auto text-slate-400">⌄</span>
            </button>
          </div>
          {mobileMenu && <button className="lg:hidden mt-4 text-sm text-slate-500" onClick={() => setMobileMenu(false)}>Kapat ✕</button>}
        </aside>

        {/* Content */}
        <main className="flex-1 min-w-0">{children}</main>
      </div>
    </div>
  );
}
