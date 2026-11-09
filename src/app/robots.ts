import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// /robots.txt olarak otomatik yayınlanır.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: [
          "/panel/",      // giriş gerektiren yönetim paneli
          "/login",
          "/api/",        // API uçları
          "/s/",          // kısa URL yönlendirmeleri
          "/sms-callback",
        ],
      },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
