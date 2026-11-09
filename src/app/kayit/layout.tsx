import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Yeni Üyelik Aç | Toplu SMS Bayi Paneli",
  description: "WOLTSMS'e üye olun; toplu SMS paketleri, SMS API ve bayi paneline hemen erişin.",
  alternates: { canonical: "/kayit" },
};

export default function KayitLayout({ children }: { children: ReactNode }) {
  return children;
}
