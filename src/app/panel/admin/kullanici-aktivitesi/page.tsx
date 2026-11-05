"use client";
import { useEffect, useMemo, useState } from "react";
import { PageTitle, Card, Empty } from "@/components/ui";
import { EVT_TEST_BELL, LS_LOGIN_BELL_OFF } from "@/components/AdminOrderAlert";

// Admin: Kullanıcı Aktivitesi — kim çevrimiçi, ne zaman aktif oldu, ne zaman pasif oldu.
// Veri 15 sn'de bir yenilenir; giriş zili PanelShell'deki bildirim bileşeninden çalar.

type UserRow = {
  id: string; username: string; name: string; role: string | null; accountActive: boolean;
  online: boolean; activeSince: string | null; lastLoginAt: string | null; lastSeenAt: string | null;
  lastInactiveAt: string | null; lastEndReason: "logout" | "timeout" | null;
  todaySessions: number; todayActiveSeconds: number; ip: string | null; userAgent: string | null;
};
type EventRow = { sessionId: string; userId: string; username: string; name: string; type: "login" | "resume" | "logout" | "timeout"; at: string; ip: string | null; userAgent: string | null };
type Data = { serverTime: string; timeoutSeconds: number; summary: { online: number; totalUsers: number; todayLogins: number; activeToday: number }; users: UserRow[]; events: EventRow[] };

const EVENT_LABEL: Record<EventRow["type"], { text: string; dot: string }> = {
  login: { text: "Giriş yaptı", dot: "bg-green-500" },
  resume: { text: "Yeniden aktif oldu", dot: "bg-emerald-400" },
  logout: { text: "Çıkış yaptı", dot: "bg-slate-400" },
  timeout: { text: "Pasif oldu (sinyal kesildi)", dot: "bg-amber-500" },
};

const fmt = (v: string | null) => (v ? new Date(v).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "-");
function ago(v: string | null, now: number): string {
  if (!v) return "-";
  const s = Math.max(0, Math.round((now - Date.parse(v)) / 1000));
  if (s < 60) return "az önce";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} dk önce`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} sa ${m % 60} dk önce`;
  return `${Math.floor(h / 24)} gün önce`;
}
function dur(sec: number): string {
  if (sec <= 0) return "-";
  const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h} sa ${m} dk` : m > 0 ? `${m} dk` : `${sec} sn`;
}
function device(ua: string | null): string {
  if (!ua) return "";
  const os = /Windows/i.test(ua) ? "Windows" : /Android/i.test(ua) ? "Android" : /iPhone|iPad/i.test(ua) ? "iOS" : /Mac OS/i.test(ua) ? "macOS" : /Linux/i.test(ua) ? "Linux" : "";
  const br = /Edg\//.test(ua) ? "Edge" : /OPR\//.test(ua) ? "Opera" : /Chrome\//.test(ua) ? "Chrome" : /Firefox\//.test(ua) ? "Firefox" : /Safari\//.test(ua) ? "Safari" : "";
  return [br, os].filter(Boolean).join(" · ");
}

export default function KullaniciAktivitesiPage() {
  const [data, setData] = useState<Data | null>(null);
  const [error, setError] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [filter, setFilter] = useState<"all" | "online" | "offline">("all");
  const [q, setQ] = useState("");
  const [bellOn, setBellOn] = useState(true);

  const load = () => {
    fetch("/api/panel/admin/activity", { cache: "no-store" }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (j.success) { setData(j.data); setError(""); } else setError(j.message || "Veri alınamadı.");
    }).catch(() => setError("Veri alınamadı."));
  };

  useEffect(() => {
    load();
    try { setBellOn(window.localStorage.getItem(LS_LOGIN_BELL_OFF) !== "1"); } catch { /* */ }
    const r = setInterval(load, 15_000);
    const t = setInterval(() => setNow(Date.now()), 10_000);
    return () => { clearInterval(r); clearInterval(t); };
  }, []);

  const toggleBell = () => {
    const next = !bellOn;
    setBellOn(next);
    try { window.localStorage.setItem(LS_LOGIN_BELL_OFF, next ? "0" : "1"); } catch { /* */ }
    if (next) window.dispatchEvent(new Event(EVT_TEST_BELL));
  };

  const users = useMemo(() => {
    const term = q.trim().toLocaleLowerCase("tr-TR");
    return (data?.users ?? []).filter((u) =>
      (filter === "all" || (filter === "online" ? u.online : !u.online)) &&
      (!term || u.username.toLocaleLowerCase("tr-TR").includes(term) || (u.name || "").toLocaleLowerCase("tr-TR").includes(term))
    );
  }, [data, filter, q]);

  return (
    <div>
      <div className="flex items-center justify-between flex-wrap gap-2 mb-1">
        <PageTitle>Kullanıcı Aktivitesi</PageTitle>
        <div className="flex gap-2">
          <button onClick={toggleBell} className={`text-[13px] px-4 py-2 rounded-lg border font-semibold ${bellOn ? "border-indigo-300 bg-indigo-50 text-indigo-700" : "bg-white dark:bg-slate-800"}`}>
            {bellOn ? "🔔 Giriş zili açık" : "🔕 Giriş zili kapalı"}
          </button>
          <button onClick={() => window.dispatchEvent(new Event(EVT_TEST_BELL))} className="btn-outline text-[13px] px-4 py-2">Zili dene</button>
        </div>
      </div>
      <p className="text-[12px] text-slate-500 mb-4">
        Bir kullanıcı sisteme girdiğinde (ya da pasifken geri döndüğünde) panelin açık olduğu her sayfada zil çalar.
        Panel açıkken kullanıcının tarayıcısı dakikada bir sinyal gönderir; {Math.round((data?.timeoutSeconds ?? 180) / 60)} dakika sinyal gelmezse kullanıcı pasif sayılır.
      </p>

      {error && <div className="card mb-3 text-sm text-red-700">{error}</div>}

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-5">
        <Card className="!p-4"><div className="text-[12px] text-slate-500 font-semibold">ŞU AN ÇEVRİMİÇİ</div><div className="text-3xl font-extrabold text-green-600">{data?.summary.online ?? "–"}</div></Card>
        <Card className="!p-4"><div className="text-[12px] text-slate-500 font-semibold">BUGÜN GİRİŞ</div><div className="text-3xl font-extrabold">{data?.summary.todayLogins ?? "–"}</div></Card>
        <Card className="!p-4"><div className="text-[12px] text-slate-500 font-semibold">BUGÜN AKTİF KULLANICI</div><div className="text-3xl font-extrabold">{data?.summary.activeToday ?? "–"}</div></Card>
        <Card className="!p-4"><div className="text-[12px] text-slate-500 font-semibold">TOPLAM KULLANICI</div><div className="text-3xl font-extrabold text-slate-500">{data?.summary.totalUsers ?? "–"}</div></Card>
      </div>

      <div className="flex gap-2 mb-3 flex-wrap items-center">
        {([["all", "Tümü"], ["online", "Çevrimiçi"], ["offline", "Pasif"]] as const).map(([k, label]) => (
          <button key={k} onClick={() => setFilter(k)} className={`px-4 py-2 rounded-lg text-sm font-bold ${filter === k ? "tab-active" : "bg-white dark:bg-slate-800 border"}`}>{label}</button>
        ))}
        <input className="input !w-60 ml-auto" placeholder="Kullanıcı ara" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card !p-0 overflow-x-auto mb-6">
        <table className="w-full table-head">
          <thead><tr className="text-left border-b">
            <th>Kullanıcı</th><th>Durum</th><th>Aktif oldu</th><th>Son görülme</th><th>Pasif oldu</th><th>Son giriş</th><th>Bugün</th><th>Cihaz / IP</th>
          </tr></thead>
          <tbody>
            {data && users.length === 0 && <tr><td colSpan={8}><Empty text="Kullanıcı bulunamadı." /></td></tr>}
            {users.map((u) => (
              <tr key={u.id} className="table-row">
                <td>
                  <div className="font-semibold">{u.name || u.username}</div>
                  <div className="text-[11px] text-slate-500">@{u.username}{u.role ? ` · ${u.role}` : ""}{!u.accountActive && <span className="text-red-600"> · hesap pasif</span>}</div>
                </td>
                <td>
                  <span className={`inline-flex items-center gap-1.5 text-[12px] font-bold px-2 py-0.5 rounded-full ${u.online ? "bg-green-50 text-green-700" : "bg-slate-100 text-slate-500 dark:bg-slate-800"}`}>
                    <span className={`w-2 h-2 rounded-full ${u.online ? "bg-green-500 animate-pulse" : "bg-slate-400"}`} />
                    {u.online ? "Çevrimiçi" : "Pasif"}
                  </span>
                </td>
                <td className="text-[13px]">{u.online ? <>{fmt(u.activeSince)}<div className="text-[11px] text-slate-500">{ago(u.activeSince, now)}</div></> : "-"}</td>
                <td className="text-[13px]">{ago(u.lastSeenAt, now)}<div className="text-[11px] text-slate-500">{fmt(u.lastSeenAt)}</div></td>
                <td className="text-[13px]">{u.online ? "-" : <>{fmt(u.lastInactiveAt)}{u.lastEndReason && <div className="text-[11px] text-slate-500">{u.lastEndReason === "logout" ? "çıkış yaptı" : "sinyal kesildi"}</div>}</>}</td>
                <td className="text-[13px]">{fmt(u.lastLoginAt)}</td>
                <td className="text-[13px]">{u.todaySessions > 0 ? `${u.todaySessions} oturum` : "-"}<div className="text-[11px] text-slate-500">{dur(u.todayActiveSeconds)}</div></td>
                <td className="text-[11px] text-slate-500">{device(u.userAgent)}<div>{u.ip || ""}</div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h2 className="font-bold text-[15px] mb-2">Son olaylar</h2>
      <div className="card !p-0 overflow-x-auto">
        <table className="w-full table-head">
          <thead><tr className="text-left border-b"><th>Zaman</th><th>Kullanıcı</th><th>Olay</th><th>Cihaz / IP</th></tr></thead>
          <tbody>
            {data && data.events.length === 0 && <tr><td colSpan={4}><Empty text="Henüz kayıtlı oturum yok." /></td></tr>}
            {(data?.events ?? []).map((e: EventRow, i: number) => (
              <tr key={`${e.sessionId}-${e.type}-${i}`} className="table-row">
                <td className="text-[13px] whitespace-nowrap">{fmt(e.at)}<div className="text-[11px] text-slate-500">{ago(e.at, now)}</div></td>
                <td className="text-[13px]"><span className="font-semibold">{e.name || e.username}</span> <span className="text-slate-500">@{e.username}</span></td>
                <td className="text-[13px]"><span className="inline-flex items-center gap-1.5"><span className={`w-2 h-2 rounded-full ${EVENT_LABEL[e.type].dot}`} />{EVENT_LABEL[e.type].text}</span></td>
                <td className="text-[11px] text-slate-500">{device(e.userAgent)}{e.ip ? ` · ${e.ip}` : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
