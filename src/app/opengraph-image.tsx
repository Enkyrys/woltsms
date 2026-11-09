import { ImageResponse } from "next/og";

export const alt = "WOLTSMS - Toplu SMS ve Bayi SMS Paneli";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

// Paylaşım (WhatsApp, Telegram, sosyal medya) önizleme görseli
export default function OgImage() {
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", justifyContent: "center", padding: 80, background: "linear-gradient(135deg,#0FB5A0,#0A8F7E)", color: "#fff" }}>
        <div style={{ fontSize: 96, fontWeight: 800 }}>WOLTSMS</div>
        <div style={{ fontSize: 48, marginTop: 20 }}>Toplu SMS & Bayi SMS Paneli</div>
        <div style={{ fontSize: 32, marginTop: 28, opacity: 0.9 }}>Ucuz paketler · SMS API · Zamanlanmış gönderim</div>
      </div>
    ),
    size,
  );
}
