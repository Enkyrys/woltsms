"use client";
import { useEffect, useState } from "react";
import { PageTitle, Pagination, Empty } from "@/components/ui";
import UserDeleteModal from "@/components/UserDeleteModal";

// Admin: Üyelik Yönetimi — üyelikleri askıya al / yeniden aktifleştir / kalıcı olarak sil.
type Row = { id: string; username: string; name: string; email: string; phone: string; isActive: boolean; roleName: string; quota: string; createdAt: string; signupPending: boolean; signupNote: string; signupIp: string };

export default function UyeliklerPage() {
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [total, setTotal] = useState(0);
  const [search, setSearch] = useState("");
  const [deleting, setDeleting] = useState<Row | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; t: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [me, setMe] = useState<string>("");
  const [pending, setPending] = useState<Row[]>([]);

  const loadPending = () => {
    fetch("/api/panel/users?pending=1&perPage=100").then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (j.success) setPending(j.data);
    });
  };
  const approve = async (r: Row) => {
    setBusy(r.id);
    const res = await fetch("/api/panel/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, approve: true }) });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    setNotice({ ok: !!j.success, t: j.message || "İşlem başarısız." });
    loadPending(); load();
  };
  const reject = async (r: Row) => {
    if (!confirm(`@${r.username} başvurusu reddedilsin mi? Başvuru kaydı silinir.`)) return;
    setBusy(r.id);
    const res = await fetch(`/api/panel/users?id=${r.id}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    setNotice({ ok: !!j.success, t: j.success ? `@${r.username} başvurusu reddedildi.` : j.message || "İşlem başarısız." });
    loadPending();
  };

  const load = (p = page, pp = perPage, q = search) => {
    fetch(`/api/panel/users?page=${p}&perPage=${pp}&pending=0&search=${encodeURIComponent(q)}`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (j.success) { setRows(j.data); setTotal(j.meta.total); setPage(j.meta.page); setPerPage(j.meta.perPage); }
      else setNotice({ ok: false, t: j.message || "Liste alınamadı." });
    });
  };
  useEffect(() => {
    load(1, 20, "");
    loadPending();
    const t = setInterval(loadPending, 30_000);
    fetch("/api/auth/me").then(async (r) => { if (r.ok) { const j = await r.json(); setMe(j.data?.id || ""); } });
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const setActive = async (r: Row, active: boolean) => {
    if (!active && !confirm(`@${r.username} askıya alınsın mı? Kullanıcı giriş yapamaz ve açık oturumu kapanır. Verileri silinmez.`)) return;
    setBusy(r.id);
    const res = await fetch("/api/panel/users", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: r.id, isActive: active }) });
    const j = await res.json().catch(() => ({}));
    setBusy(null);
    setNotice({ ok: !!j.success, t: j.success ? `@${r.username} ${active ? "yeniden aktifleştirildi" : "askıya alındı"}.` : j.message || "İşlem başarısız." });
    load();
  };

  return (
    <div>
      <PageTitle>Üyelik Yönetimi</PageTitle>
      <p className="text-[12px] text-slate-500 mb-4 max-w-3xl">
        <b>Askıya al</b>: kullanıcı giriş yapamaz, API anahtarları çalışmaz, verileri korunur; istediğiniz zaman yeniden aktifleştirebilirsiniz.
        {" "}<b>Üyeliği sil</b>: kullanıcı ve ona ait tüm veriler (kampanyalar, SMS kayıtları, bakiye hareketleri, rehber) kalıcı olarak silinir.
      </p>
      {notice && <div className={`card mb-3 text-sm flex justify-between gap-3 ${notice.ok ? "" : "text-red-700"}`}><span>{notice.t}</span><button onClick={() => setNotice(null)} aria-label="Kapat">✕</button></div>}

      <div className="card !p-0 mb-6 overflow-hidden border-amber-200">
        <div className="px-4 py-3 bg-amber-50 border-b border-amber-200 flex items-center justify-between">
          <span className="font-bold text-sm text-amber-900">🆕 Onay bekleyen başvurular ({pending.length})</span>
          <span className="text-[11px] text-amber-800">Ana sayfadaki &quot;Yeni Üyelik Aç&quot; formundan gelir. Onaylanana kadar giriş yapılamaz.</span>
        </div>
        {pending.length === 0 ? (
          <div className="px-4 py-4 text-sm text-slate-500">Bekleyen başvuru yok.</div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full table-head">
              <thead><tr className="text-left border-b"><th>Başvuran</th><th>İletişim</th><th>Not</th><th>Başvuru</th><th className="text-right">İşlem</th></tr></thead>
              <tbody>
                {pending.map((r) => (
                  <tr key={r.id} className="table-row">
                    <td><div className="font-semibold">{r.name}</div><div className="text-[11px] text-slate-500">@{r.username}</div></td>
                    <td className="text-[13px]">
                      {r.phone && <a className="text-[#0A8F7E] font-semibold" href={`https://wa.me/${r.phone.replace(/[^0-9]/g, "")}`} target="_blank" rel="noopener noreferrer">{r.phone}</a>}
                      {r.email && !r.email.endsWith("@woltsms.local") && <div className="text-[11px] text-slate-500">{r.email}</div>}
                    </td>
                    <td className="text-[12px] text-slate-600 max-w-[260px] whitespace-pre-wrap">{r.signupNote || "-"}</td>
                    <td className="text-[12px]">{new Date(r.createdAt).toLocaleString("tr-TR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })}{r.signupIp && <div className="text-[11px] text-slate-400">{r.signupIp}</div>}</td>
                    <td className="text-right whitespace-nowrap">
                      <button disabled={busy === r.id} className="btn-primary text-[12px] px-3 py-1.5 mr-2" onClick={() => approve(r)}>Onayla</button>
                      <button disabled={busy === r.id} className="btn-red text-[12px] px-3 py-1.5" onClick={() => reject(r)}>Reddet</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="flex justify-end gap-2 mb-3">
        <input value={search} onChange={(e) => setSearch(e.target.value)} onKeyDown={(e) => e.key === "Enter" && load(1, perPage, search)} className="input !w-56" placeholder="Kullanıcı adı / isim ara" />
        <button onClick={() => load(1, perPage, search)} className="btn-outline px-3 text-sm">Ara</button>
      </div>

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full table-head">
          <thead><tr className="text-left border-b"><th>Kullanıcı</th><th>Rol</th><th>Durum</th><th>Bakiye</th><th>Üyelik tarihi</th><th className="text-right">İşlem</th></tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={6}><Empty text="Kullanıcı bulunamadı." /></td></tr>}
            {rows.map((r) => {
              const self = r.id === me;
              return (
                <tr key={r.id} className="table-row">
                  <td><div className="font-semibold">{r.name}</div><div className="text-[11px] text-slate-500">@{r.username}{self ? " · siz" : ""}</div></td>
                  <td className="text-[13px]">{r.roleName || "-"}</td>
                  <td>{r.isActive
                    ? <span className="text-[12px] font-bold text-green-700 bg-green-50 px-2 py-0.5 rounded-full">Aktif</span>
                    : <span className="text-[12px] font-bold text-red-700 bg-red-50 px-2 py-0.5 rounded-full">Askıda</span>}</td>
                  <td className="text-[13px]">₺{Number(r.quota).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}</td>
                  <td className="text-[13px]">{new Date(r.createdAt).toLocaleDateString("tr-TR")}</td>
                  <td className="text-right whitespace-nowrap">
                    {!self && (r.isActive
                      ? <button disabled={busy === r.id} className="btn-outline text-[12px] px-3 py-1.5 mr-2" onClick={() => setActive(r, false)}>Askıya al</button>
                      : <button disabled={busy === r.id} className="btn-outline text-[12px] px-3 py-1.5 mr-2" onClick={() => setActive(r, true)}>Aktifleştir</button>)}
                    {!self && <button className="btn-red text-[12px] px-3 py-1.5" onClick={() => setDeleting(r)}>Üyeliği sil</button>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination page={page} perPage={perPage} total={total} onChange={(p, pp) => load(p, pp, search)} />
      </div>

      {deleting && (
        <UserDeleteModal
          userId={deleting.id}
          onClose={() => setDeleting(null)}
          onDeleted={(msg) => { setDeleting(null); setNotice({ ok: true, t: msg }); load(); }}
          onSuspend={() => { const r = deleting; setDeleting(null); void setActive(r, false); }}
        />
      )}
    </div>
  );
}
