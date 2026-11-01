import type { NextConfig } from "next";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || "";

const nextConfig: NextConfig = {
  // Supabase Storage görselleri/dosyaları için imzalı URL'ler sunucudan gelir
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.supabase.co",
        pathname: "/storage/v1/object/**",
      },
    ],
  },
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Frame-Options", value: "DENY" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
      ],
    },
    {
      source: "/api/v1/:path*",
      headers: [{ key: "Access-Control-Allow-Credentials", value: "false" }],
    },
  ],
  env: {
    // supabaseUrl istemciye sadece public anahtarla gider; service_role asla
    NEXT_PUBLIC_SUPABASE_URL: supabaseUrl,
  },
};

export default nextConfig;
