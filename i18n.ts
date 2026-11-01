export type Locale = "tr" | "en";

export const locales: { code: Locale; label: string; flag: string }[] = [
  { code: "tr", label: "TR", flag: "🇹🇷" },
  { code: "en", label: "EN", flag: "🇬🇧" },
];

const dict = {
  tr: {
    dashboard: "Dashboard",
    contacts: "Rehber",
    orders: "Siparişler",
    users: "Kullanıcılar",
    roles: "Roller",
    blacklist: "Karaliste",
    topup: "Kredi Yükle",
    transactions: "İşlem Geçmişi",
    shorturls: "Kısa URL'ler",
    support: "Destek Talepleri",
    panel: "Panel",
    newSms: "Yeni Sms Gönder",
    newOrder: "Yeni Sipariş",
    allOrders: "Tüm Siparişler",
    create: "Oluştur",
  },
  en: {
    dashboard: "Dashboard",
    contacts: "Phonebook",
    orders: "Orders",
    users: "Users",
    roles: "Roles",
    blacklist: "Blacklist",
    topup: "Top Up",
    transactions: "Transactions",
    shorturls: "Short URLs",
    support: "Support Tickets",
    panel: "Panel",
    newSms: "New SMS",
    newOrder: "New Order",
    allOrders: "All Orders",
    create: "Create",
  },
} as const;

export function t(locale: Locale, key: keyof (typeof dict)["tr"]): string {
  return dict[locale][key] ?? dict.tr[key];
}
