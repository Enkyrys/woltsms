export const brand = {
  name: "WOLTSMS",
  tagline: "Bayi SMS Paneli",
  primary: "#0FB5A0",
  primaryDark: "#0A8F7E",
  primaryLight: "#E6FAF7",
  background: "#F8FAFC",
  danger: "#EF4444",
  dangerLight: "#FCA5A5",
  success: "#22C55E",
  warning: "#F97316",
  font: "'Outfit','Plus Jakarta Sans',system-ui,sans-serif",
  logoText: "WOLTSMS",
  announcementDefault:
    "Gönderimler 10:00–22:00 saatleri arasında aktiftir. 22:00 sonrası yapılan SMS gönderimleri iptal edilecektir. Bilginize sunar, iyi çalışmalar dileriz.",
  sendingStartHour: 10,
  sendingEndHour: 22,
  timezone: "Europe/Istanbul",
} as const;

export type Brand = typeof brand;
