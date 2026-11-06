"use client";
import { useEffect, useState } from "react";
import { PageTitle, Pagination, Empty } from "@/components/ui";
import UserDeleteModal from "@/components/UserDeleteModal";

// Admin: Üyelik Yönetimi — üyelikleri askıya al / yeniden aktifleştir / kalıcı olarak sil.
type Row = { id: string; username: string; name: string; email: string; isActive: boolean; roleName: string; quota: string; createdAt: string };

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

  const load = (p = page, pp = perPage, q = search) => {
    fetch(`/api/panel/users?page=${p}&perPage=${pp}&search=${encodeURIComponent(q)}`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (j.success) { setRows(j.data); setTotal(j.meta.total); setPage(j.meta.page); setPerPage(j.meta.perPage); }
      else setNotice({ ok: false, t: j.message || "Liste alınamadı." });
    });
  };
  useEffect(() => {
    load(1, 20, "");
    fetch("/api/auth/me").then(async (r) => { if (r.ok) { const j = await r.json(); setMe(j.data?.id || ""); } });
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
