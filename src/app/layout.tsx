import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import "./globals.css";
import { SEO, SITE_URL } from "@/lib/seo";

export const viewport: Viewport = { themeColor: "#0FB5A0", width: "device-width", initialScale: 1 };

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SEO.title, template: "%s | WOLTSMS" },
  description: SEO.description,
  keywords: [...SEO.keywords],
  applicationName: SEO.name,
  alternates: { canonical: "/" },
  icons: { icon: "/favicon.svg" },
  openGraph: {
    type: "website",
    locale: SEO.locale,
    url: "/",
    siteName: SEO.name,
    title: SEO.title,
    description: SEO.description,
  },
  twitter: { card: "summary_large_image", title: SEO.title, description: SEO.description },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large", "max-snippet": -1 },
  },
  // Google Search Console HTML etiketi doğrulaması için .env: GOOGLE_SITE_VERIFICATION=...
  verification: { google: process.env.GOOGLE_SITE_VERIFICATION || undefined },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="tr">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@400;500;600;700;800&display=swap" rel="stylesheet" />
      </head>
      <body className="antialiased">{children}</body>
    </html>
  );
}
