import type { Metadata } from "next";
import type { ReactNode } from "react";

export const metadata: Metadata = {
  title: "Giriş Yap",
  robots: { index: false, follow: false },
  alternates: { canonical: "/login" },
};

export default function LoginLayout({ children }: { children: ReactNode }) {
  return children;
}
