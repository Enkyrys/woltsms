// Ana SMS sağlayıcısı — panelde ve dokümanlarda görünen marka adı: ENKYRYS.
//
// Not: Sağlayıcının gerçek teknik API adresi aşağıdaki varsayılandır. Bu bir
// üçüncü taraf endpoint'idir; marka değişikliği kapsamında DEĞİŞTİRİLMEZ (değişirse
// gönderim durur). Farklı bir adres gerekirse ENKYRYS_API_BASE_URL ortam değişkeni
// veya Sistem > Sağlayıcı ekranındaki "Base URL" alanı kullanılır.
export const PROVIDER_BRAND = "ENKYRYS";

export const PROVIDER_DEFAULT_BASE_URL =
  (typeof process !== "undefined" && process.env?.ENKYRYS_API_BASE_URL) || "https://restapi.sempico.solutions/v1";

// Sağlayıcı saat dilimi (beginDate/beginTime) — ENKYRYS paneli saati UTC'dir.
export const PROVIDER_TIMEZONE = "UTC";
