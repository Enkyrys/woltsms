import type { Metadata } from "next";
import PanelShell from "@/components/PanelShell";

// Panel giriş gerektirir; arama sonuçlarında çıkmasın.
export const metadata: Metadata = {
  title: "Panel",
  robots: { index: false, follow: false },
};

export default function PanelLayout({ children }: { children: React.ReactNode }) {
  return <PanelShell>{children}</PanelShell>;
}
