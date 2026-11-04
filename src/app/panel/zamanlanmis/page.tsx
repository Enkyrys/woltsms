"use client";
import { useEffect, useState } from "react";
import { PageTitle, Card, Pagination, OrderStatusBadge, Empty } from "@/components/ui";
import CampaignEditModal, { fmtWhen, type EditableCampaign } from "@/components/CampaignEditModal";

// Zamanlanmış kampanyalar: gönderim zamanı bekleyenler + taslaklar.
// Gönderim sunucudaki dakikalık zamanlayıcı ile yapılır; bu sayfanın açık olması gerekmez.

type Row = {
  id: string; name: string | null; status: string; totalCount: number; totalCost: string; message: string;
  scheduledAt: string | null; providerScheduledAt: string | null; providerTimezone: string; createdAt: string; username: string;
};

function fmtProviderTime(v: unknown, tz: unknown): string {
  const m = String(v ?? "").match(/^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})/);
  return m ? `${m[3]}.${m[2]}.${m[1]} ${m[4]}:${m[5]} ${String(tz || "UTC")}` : "-";
}

function countdown(targetMs: number, now: number): string {
  const s = Math.max(0, Math.round((targetMs - now) / 1000));
  if (s === 0) return "şimdi gönderiliyor";
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
  if (d > 0) return `${d} gün ${h} sa sonra`;
  if (h > 0) return `${h} sa ${m} dk sonra`;
  return m > 0 ? `${m} dk sonra` : `${s} sn sonra`;
}

export default function ZamanlanmisPage() {
  const [tab, setTab] = useState<"scheduled" | "draft" | "recent">("scheduled");
  const [rows, setRows] = useState<Row[]>([]);
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(20);
  const [total, setTotal] = useState(0);
  const [now, setNow] = useState(() => Date.now());
  const [editing, setEditing] = useState<EditableCampaign | null>(null);
  const [notice, setNotice] = useState("");
  const [counts, setCounts] = useState<{ scheduled: number; draft: number }>({ scheduled: 0, draft: 0 });

  const statusFor = (t: typeof tab) => (t === "scheduled" ? "scheduled" : t === "draft" ? "draft" : "pending,processing,completed,partial,failed");

  const load = (t = tab, p = page, pp = perPage) => {
    const sort = t === "scheduled" ? "&sort=scheduled" : "";
    fetch(`/api/panel/orders?status=${statusFor(t)}&page=${p}&perPage=${pp}${sort}`).then(async (r) => {
      const j = await r.json();
      if (j.success) { setRows(j.data); setTotal(j.meta.total); setPage(j.meta.page); setPerPage(j.meta.perPage); }
    });
  };
  const loadCounts = () => {
    Promise.all(["scheduled", "draft"].map((st) =>
      fetch(`/api/panel/orders?status=${st}&perPage=1`).then((r) => r.json()).then((j) => (j.success ? Number(j.meta.total) : 0)).catch(() => 0)
    )).then(([scheduled, draft]) => setCounts({ scheduled, draft }));
  };

  useEffect(() => {
    load("scheduled", 1, 20);
    loadCounts();
    const t = setInterval(() => setNow(Date.now()), 1000);
    // zamanı gelen kampanyalar listeden düşsün diye 30 sn'de bir yenile
    const r = setInterval(() => { load(); loadCounts(); }, 30_000);
    return () => { clearInterval(t); clearInterval(r); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const switchTab = (t: typeof tab) => { setTab(t); load(t, 1, perPage); };

  const cancel = async (r: Row) => {
    const what = r.status === "draft" ? "Taslak iptal edilsin mi?" : "Zamanlanmış kampanya iptal edilsin mi? Rezerve edilen bakiye iade edilir.";
    if (!confirm(what)) return;
    const res = await fetch(`/api/panel/orders?id=${r.id}`, { method: "DELETE" });
    const j = await res.json().catch(() => ({}));
    setNotice(j.message || (j.success ? "İptal edildi." : "İptal edilemedi."));
    load(); loadCounts();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-1 flex-wrap gap-2">
        <a href="/panel/siparisler" className="text-[#0FB5A0] font-semibold text-[14px]">← Tüm Kampanyalar</a>
        <a href="/panel/dashboard" className="btn-primary text-[13px] px-5 py-2.5">+ Yeni Kampanya</a>
      </div>
      <PageTitle>Zamanlanmış Kampanyalar</PageTitle>

      <div className="grid sm:grid-cols-3 gap-4 mb-4">
        <Card className="!p-4"><div className="text-[12px] text-slate-500 font-semibold">ZAMANLANDI</div><div className="text-2xl font-extrabold text-[#0A8F7E]">{counts.scheduled}</div><div className="text-[12px] text-slate-500">gönderim zamanını bekliyor</div></Card>
        <Card className="!p-4"><div className="text-[12px] text-slate-500 font-semibold">TASLAK</div><div className="text-2xl font-extrabold">{counts.draft}</div><div className="text-[12px] text-slate-500">bakiye rezervi yapılmadı</div></Card>
        <Card className="!p-4 text-[12px] text-slate-600">Zamanı gelen kampanya sunucudaki zamanlayıcı tarafından <b>otomatik</b> olarak ENKYRYS API&apos;sine gönderilir. Bu sayfanın ya da panelin açık olması gerekmez.</Card>
      </div>

      {notice && <div className="card mb-3 text-sm flex justify-between"><span>{notice}</span><button onClick={() => setNotice("")}>✕</button></div>}

      <div className="flex gap-2 mb-3 flex-wrap">
        {([["scheduled", `Zamanlandı (${counts.scheduled})`], ["draft", `Taslaklar (${counts.draft})`], ["recent", "Gönderilenler"]] as const).map(([t, label]) => (
          <button key={t} onClick={() => switchTab(t)} className={`px-5 py-2 rounded-lg text-sm font-bold ${tab === t ? "tab-active" : "bg-white dark:bg-slate-800 border"}`}>{label}</button>
        ))}
      </div>

      <div className="card !p-0 overflow-x-auto">
        <table className="w-full table-head">
          <thead><tr className="text-left border-b">
            <th>Kampanya</th><th>Durum</th><th>Alıcı</th><th>Planlanan (sizin saatiniz)</th><th>ENKYRYS Saati</th><th>Kalan</th><th>İşlem</th>
          </tr></thead>
          <tbody>
            {rows.length === 0 && <tr><td colSpan={7}><Empty text={tab === "draft" ? "Taslak bulunamadı." : tab === "scheduled" ? "Zamanlanmış kampanya yok." : "Kampanya bulunamadı."} /></td></tr>}
            {rows.map((r) => {
              const ms = r.scheduledAt ? Date.parse(r.scheduledAt) : NaN;
              return (
                <tr key={r.id} className="table-row">
                  <td>
                    <div className="font-bold">{r.name || `#${r.id.slice(0, 8)}`}</div>
                    <div className="text-[11px] text-slate-500 truncate max-w-[260px]">{r.message}</div>
                    {r.username && <div className="text-[11px] text-slate-400">@{r.username}</div>}
                  </td>
                  <td><OrderStatusBadge status={r.status} /></td>
                  <td>{r.totalCount}</td>
                  <td>{Number.isFinite(ms) ? fmtWhen(ms) : r.status === "draft" ? "Hemen (taslak)" : "-"}</td>
                  <td className="font-mono text-[12px]">{r.status === "draft" ? "-" : fmtProviderTime(r.providerScheduledAt, r.providerTimezone)}</td>
                  <td className="text-[12px]">{r.status === "scheduled" && Number.isFinite(ms) ? countdown(ms, now) : "-"}</td>
                  <td className="whitespace-nowrap">
                    {r.status === "scheduled" && (
                      <button className="btn-outline text-[12px] px-2.5 py-1 mr-1" onClick={() => setEditing({ id: r.id, name: r.name, message: r.message, scheduledAt: r.scheduledAt })}>Düzenle</button>
                    )}
                    {r.status === "draft" && <a className="btn-primary text-[12px] px-2.5 py-1 mr-1 inline-block" href={`/panel/dashboard?draft=${r.id}`}>Aç / Gönder</a>}
                    {(r.status === "scheduled" || r.status === "draft") && (
                      <button className="btn-red text-[12px] px-2.5 py-1" onClick={() => cancel(r)}>İptal</button>
                    )}
                    {tab === "recent" && <a className="text-[#0FB5A0] text-[12px] font-semibold" href="/panel/siparisler">Detay →</a>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        <Pagination page={page} perPage={perPage} total={total} onChange={(p, pp) => load(tab, p, pp)} />
      </div>

      {editing && (
        <CampaignEditModal
          campaign={editing}
          onClose={() => setEditing(null)}
          onSaved={(msg) => { setEditing(null); setNotice(msg); load(); }}
        />
      )}
    </div>
  );
}
