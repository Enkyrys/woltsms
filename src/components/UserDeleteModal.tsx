"use client";
import { useEffect, useState } from "react";
import { Modal } from "@/components/ui";

// Üyelik silme onayı: önce silinecek verilerin özeti gösterilir, kullanıcı adı yazılarak onaylanır.
type Preview = {
  username: string; name: string; is_active: boolean; is_admin: boolean; is_self: boolean;
  balance: string | number; reserved: string | number; orders: number; active_orders: number;
  messages: number; transactions: number; last_login_at: string | null; created_at: string;
};

export default function UserDeleteModal({
  userId,
  onClose,
  onDeleted,
  onSuspend,
}: {
  userId: string;
  onClose: () => void;
  onDeleted: (msg: string) => void;
  onSuspend?: () => void; // "silmek yerine askıya al" seçeneği
}) {
  const [p, setP] = useState<Preview | null>(null);
  const [err, setErr] = useState("");
  const [typed, setTyped] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch(`/api/panel/users?id=${userId}&preview=1`, { method: "DELETE" }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (j.success) setP(j.data); else setErr(j.message || "Bilgi alınamadı.");
    });
  }, [userId]);

  const blocked = !!p && (p.is_self || p.active_orders > 0 || Number(p.reserved) > 0);
  const canDelete = !!p && !blocked && typed.trim() === p.username;

  const del = async () => {
    if (!canDelete) return;
    setBusy(true); setErr("");
    const r = await fetch(`/api/panel/users?id=${userId}`, { method: "DELETE" });
    const j = await r.json().catch(() => ({}));
    setBusy(false);
    if (j.success) onDeleted(j.message || "Üyelik silindi.");
    else setErr(j.message || "Silinemedi.");
  };

  const money = (v: string | number) => `₺${Number(v).toLocaleString("tr-TR", { minimumFractionDigits: 2 })}`;

  return (
    <Modal title="Üyeliği sil" onClose={onClose}>
      {!p && !err && <div className="text-sm text-slate-500">Yükleniyor…</div>}
      {p && (
        <div className="space-y-3 text-sm">
          <div className="rounded-lg border border-red-200 bg-red-50 text-red-900 p-3">
            <b>{p.name} (@{p.username})</b> üyeliği ve bu kullanıcıya ait <b>tüm veriler kalıcı olarak silinir</b>. Bu işlem geri alınamaz.
          </div>
          <div className="grid grid-cols-2 gap-x-4 gap-y-1">
            <div>Bakiye: <b>{money(p.balance)}</b></div>
            <div>Rezerve: <b>{money(p.reserved)}</b></div>
            <div>Kampanya: <b>{p.orders}</b></div>
            <div>SMS kaydı: <b>{p.messages}</b></div>
            <div>Bakiye hareketi: <b>{p.transactions}</b></div>
            <div>Son giriş: <b>{p.last_login_at ? new Date(p.last_login_at).toLocaleString("tr-TR") : "-"}</b></div>
          </div>
          {Number(p.balance) > 0 && !blocked && (
            <div className="text-[12px] text-amber-800 bg-amber-50 rounded-lg p-2">Kullanıcının {money(p.balance)} bakiyesi var; üyelik silinince bu bakiye de silinir.</div>
          )}
          {p.is_self && <div className="text-[13px] text-red-700">Kendi üyeliğinizi silemezsiniz.</div>}
          {!p.is_self && (p.active_orders > 0 || Number(p.reserved) > 0) && (
            <div className="text-[13px] text-red-700">Kullanıcının gönderimi süren ya da zamanlanmış {p.active_orders} kampanyası var. Silmeden önce bu kampanyaları iptal edin.</div>
          )}
          {!blocked && (
            <div>
              <label className="label">Onaylamak için kullanıcı adını yazın: <b>{p.username}</b></label>
              <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} placeholder={p.username} autoComplete="off" />
            </div>
          )}
          {err && <div className="text-[13px] text-red-700">{err}</div>}
          <div className="flex justify-between gap-2 pt-1 flex-wrap">
            {onSuspend && p.is_active && !p.is_self ? (
              <button className="btn-outline px-4 py-2 text-[13px]" onClick={onSuspend}>Silmek yerine askıya al</button>
            ) : <span />}
            <div className="flex gap-2">
              <button className="btn-outline px-4 py-2 text-[13px]" onClick={onClose}>Vazgeç</button>
              <button className="btn-red px-5 py-2 text-[13px] disabled:opacity-40" disabled={!canDelete || busy} onClick={del}>{busy ? "Siliniyor…" : "Üyeliği kalıcı olarak sil"}</button>
            </div>
          </div>
        </div>
      )}
      {!p && err && <div className="text-sm text-red-700">{err}</div>}
    </Modal>
  );
}
