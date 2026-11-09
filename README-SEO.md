# WOLTSMS SEO Kurulumu

Dosyaları proje köküne `src/` yapısını koruyarak kopyalayın (aynı adlı dosyaların üzerine yazar).

| Dosya | Görev |
|---|---|
| src/lib/seo.ts | Alan adı, anahtar kelimeler, SSS, JSON-LD |
| src/app/robots.ts | /robots.txt |
| src/app/sitemap.ts | /sitemap.xml |
| src/app/layout.tsx | Title, description, keywords, Open Graph, canonical |
| src/app/page.tsx | Herkese açık landing sayfası (eski yönlendirmenin yerine) |
| src/app/opengraph-image.tsx | Paylaşım görseli |
| src/app/panel, login, kayit / layout.tsx | panel ve login noindex, kayit indekslenir |

## .env
NEXT_PUBLIC_SITE_URL=https://alanadiniz.com
GOOGLE_SITE_VERIFICATION=search-console-kodu

## Yayın sonrası
1. Search Console'a siteyi ekleyin, https://alanadiniz.com/sitemap.xml adresini gönderin.
2. Bing Webmaster Tools'a da ekleyin.
3. /robots.txt ve /sitemap.xml adreslerini tarayıcıda kontrol edin.
