"use client";
import { useCallback, useEffect, useRef, useState } from "react";

// Admin paneli: bayilerden yeni sipariş geldiğinde 5 saniyelik güçlü sesli uyarı.
// - /api/panel/admin/orders/new düzenli aralıkla yoklanır.
// - Ses Web Audio API ile üretilir (dosya gerekmez): iki tonlu siren, sıkıştırıcı ile yüksek seviye.
// - Tarayıcılar sesi ancak kullanıcı sayfayla etkileşime girdikten sonra çalar;
//   ilk tıklama/tuş ile ses motoru açılır. Açılamazsa ekranda "Sesi aç" uyarısı görünür.

const POLL_MS = 8000;
const ALARM_MS = 5000;
const LS_SEEN = "woltsms.admin.lastOrderSeen";
const LS_MUTED = "woltsms.admin.orderAlertMuted";
const STALE_MS = 10 * 60_000; // daha eski başlangıç noktası: eski siparişler için alarm çalınmaz

type NewOrder = { id: string; dealer: string; totalCount: number; totalCost: string; source: string; createdAt: string };

function lsGet(k: string): string | null {
  try { return window.localStorage.getItem(k); } catch { return null; }
}
function lsSet(k: string, v: string) {
  try { window.localStorage.setItem(k, v); } catch { /* yok say */ }
}

type AudioCtor = typeof AudioContext;
function getAudioCtor(): AudioCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as { AudioContext?: AudioCtor; webkitAudioContext?: AudioCtor };
  return w.AudioContext || w.webkitAudioContext || null;
}

// 5 saniyelik güçlü siren: 960 Hz / 1440 Hz arasında 0,25 sn'de bir geçiş.
function playAlarm(ctx: AudioContext, durationMs = ALARM_MS): () => void {
  const t0 = ctx.currentTime + 0.02;
  const dur = durationMs / 1000;

  const comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -10;
  comp.knee.value = 0;
  comp.ratio.value = 12;
  comp.attack.value = 0.003;
  comp.release.value = 0.1;

  const master = ctx.createGain();
  master.gain.setValueAtTime(0.0001, t0);
  master.gain.exponentialRampToValueAtTime(1, t0 + 0.03);
  master.gain.setValueAtTime(1, t0 + dur - 0.08);
  master.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  master.connect(comp);
  comp.connect(ctx.destination);

  const oscA = ctx.createOscillator();
  const oscB = ctx.createOscillator();
  oscA.type = "square";
  oscB.type = "sawtooth";
  const gA = ctx.createGain();
  const gB = ctx.createGain();
  gA.gain.value = 0.6;
  gB.gain.value = 0.35;
  oscA.connect(gA).connect(master);
  oscB.connect(gB).connect(master);

  const step = 0.25;
  for (let t = 0, i = 0; t < dur; t += step, i++) {
    const f = i % 2 === 0 ? 960 : 1440;
    oscA.frequency.setValueAtTime(f, t0 + t);
    oscB.frequency.setValueAtTime(f * 1.005, t0 + t); // hafif detune → daha dolgun ses
  }

  oscA.start(t0);
  oscB.start(t0);
  oscA.stop(t0 + dur + 0.02);
  oscB.stop(t0 + dur + 0.02);

  return () => {
    try {
      master.gain.cancelScheduledValues(ctx.currentTime);
      master.gain.setValueAtTime(0.0001, ctx.currentTime);
      oscA.stop();
      oscB.stop();
    } catch { /* zaten durdu */ }
  };
}

export default function AdminOrderAlert() {
  const [muted, setMuted] = useState(false);
  const [needsUnlock, setNeedsUnlock] = useState(false);
  const [toast, setToast] = useState<NewOrder[]>([]);
  const ctxRef = useRef<AudioContext | null>(null);
  const stopRef = useRef<(() => void) | null>(null);
  const sinceRef = useRef<string | null>(null);
  const mutedRef = useRef(false);

  useEffect(() => {
    const m = lsGet(LS_MUTED) === "1";
    setMuted(m);
    mutedRef.current = m;
  }, []);

  const ensureCtx = useCallback(async (): Promise<AudioContext | null> => {
    const Ctor = getAudioCtor();
    if (!Ctor) return null;
    if (!ctxRef.current) ctxRef.current = new Ctor();
    if (ctxRef.current.state === "suspended") {
      try { await ctxRef.current.resume(); } catch { /* kullanıcı etkileşimi gerekli */ }
    }
    return ctxRef.current;
  }, []);

  // ilk kullanıcı etkileşiminde ses motorunu aç
  useEffect(() => {
    const unlock = async () => {
      const ctx = await ensureCtx();
      if (ctx && ctx.state === "running") {
        setNeedsUnlock(false);
        window.removeEventListener("pointerdown", unlock);
        window.removeEventListener("keydown", unlock);
      }
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [ensureCtx]);

  const ring = useCallback(async () => {
    if (mutedRef.current) return;
    const ctx = await ensureCtx();
    if (!ctx || ctx.state !== "running") {
      setNeedsUnlock(true);
      return;
    }
    stopRef.current?.();
    stopRef.current = playAlarm(ctx, ALARM_MS);
    try { navigator.vibrate?.([400, 150, 400, 150, 400, 150, 400, 150, 400]); } catch { /* yok */ }
  }, [ensureCtx]);

  // yoklama
  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const stored = lsGet(LS_SEEN);
    const storedMs = stored ? Date.parse(stored) : NaN;
    sinceRef.current = Number.isFinite(storedMs) && Date.now() - storedMs < STALE_MS ? stored : null;

    const poll = async () => {
      try {
        const qs = sinceRef.current ? `?since=${encodeURIComponent(sinceRef.current)}` : "";
        const r = await fetch(`/api/panel/admin/orders/new${qs}`, { cache: "no-store" });
        if (r.ok) {
          const j = (await r.json()) as { data?: { latest: string | null; serverTime: string; orders: NewOrder[] } };
          const d = j.data;
          if (d && !cancelled) {
            const hadBaseline = Boolean(sinceRef.current);
            const next = d.latest || d.serverTime;
            if (next) {
              sinceRef.current = next;
              lsSet(LS_SEEN, next);
            }
            if (hadBaseline && d.orders.length > 0) {
              setToast((prev) => [...d.orders, ...prev].slice(0, 5));
              void ring();
            }
          }
        }
      } catch { /* ağ hatası: bir sonraki turda tekrar dener */ }
      if (!cancelled) timer = setTimeout(poll, POLL_MS);
    };
    void poll();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [ring]);

  const toggleMute = async () => {
    const m = !muted;
    setMuted(m);
    mutedRef.current = m;
    lsSet(LS_MUTED, m ? "1" : "0");
    if (m) {
      stopRef.current?.();
      return;
    }
    // açarken kısa bir deneme: ses motorunu da kullanıcı etkileşimiyle açar
    const ctx = await ensureCtx();
    if (ctx && ctx.state === "running") {
      setNeedsUnlock(false);
      stopRef.current?.();
      stopRef.current = playAlarm(ctx, 600);
    }
  };

  const dismiss = () => {
    stopRef.current?.();
    setToast([]);
  };

  return (
    <>
      <button
        onClick={toggleMute}
        title={muted ? "Sipariş sesli bildirimi kapalı" : "Sipariş sesli bildirimi açık (tıklayınca test eder)"}
        aria-label={muted ? "Sipariş sesli bildirimini aç" : "Sipariş sesli bildirimini kapat"}
        className="w-9 h-9 grid place-items-center rounded-lg bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 shadow-sm relative"
      >
        {muted ? "🔇" : "🔊"}
        {!muted && needsUnlock && <span className="absolute -top-1 -right-1 w-2.5 h-2.5 rounded-full bg-amber-500" />}
      </button>

      {(toast.length > 0 || (!muted && needsUnlock)) && (
        <div className="fixed top-4 right-4 z-[100] w-[min(360px,calc(100vw-32px))] space-y-2" role="alert" aria-live="assertive">
          {!muted && needsUnlock && (
            <div className="card p-3 text-[13px] border border-amber-300 bg-amber-50 text-amber-900 flex items-center justify-between gap-3">
              <span>Sipariş sesli bildirimi için sesi etkinleştirin.</span>
              <button className="btn-primary px-3 py-1.5 text-[12px]" onClick={async () => { const c = await ensureCtx(); if (c?.state === "running") { setNeedsUnlock(false); if (toast.length) void ring(); } }}>Sesi aç</button>
            </div>
          )}
          {toast.length > 0 && (
            <div className="card p-0 overflow-hidden border-2 border-[#0FB5A0] shadow-2xl">
              <div className="px-4 py-2.5 bg-[#0FB5A0] text-white font-bold text-sm flex items-center justify-between">
                <span>🔔 Yeni bayi siparişi ({toast.length})</span>
                <button onClick={dismiss} className="text-white/90 hover:text-white text-[13px]" aria-label="Kapat">✕</button>
              </div>
              <div className="max-h-64 overflow-auto">
                {toast.map((o) => (
                  <a key={o.id} href="/panel/siparisler" onClick={dismiss} className="block px-4 py-2.5 border-b text-[13px] hover:bg-slate-50 dark:hover:bg-slate-800">
                    <div className="font-semibold">{o.dealer || "Bayi"} · {o.totalCount.toLocaleString("tr-TR")} alıcı</div>
                    <div className="text-slate-500 text-[12px]">
                      {new Date(o.createdAt).toLocaleString("tr-TR")} · {o.source === "api" ? "API" : "Panel"}
                    </div>
                  </a>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
