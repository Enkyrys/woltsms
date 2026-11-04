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
    "Gönderimler 24 saat (00:00–23:59, Türkiye saati) aktiftir. Bilginize sunar, iyi çalışmalar dileriz.",
  sendingStartHour: 10,
  sendingEndHour: 22,
  timezone: "Europe/Istanbul",
} as const;

export type Brand = typeof brand;
