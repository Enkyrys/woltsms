import type { MetadataRoute } from "next";
import { SITE_URL } from "@/lib/seo";

// /sitemap.xml olarak otomatik yayınlanır. Yeni herkese açık sayfa eklerseniz buraya ekleyin.
export default function sitemap(): MetadataRoute.Sitemap {
  const now = new Date();
  return [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: "weekly", priority: 1 },
    { url: `${SITE_URL}/kayit`, lastModified: now, changeFrequency: "monthly", priority: 0.8 },
  ];
}
