import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { corsMiddleware, applyCorsHeaders } from "@/lib/cors";

// Middleware yalnızca yönlendirme/oturum yenileme içindir;
// yetki kontrolü her zaman Route Handler'da sunucuda yapılır.

export async function middleware(request: NextRequest) {
  // CORS preflight (/api/v1)
  const corsResp = corsMiddleware(request);
  if (corsResp) return corsResp;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    // yapılandırma eksikse panele yönlendir
    if (request.nextUrl.pathname.startsWith("/panel")) {
      return NextResponse.redirect(new URL("/login", request.url));
    }
    return applyCorsHeaders(NextResponse.next(), request);
  }

  let response = NextResponse.next({ request });

  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
      },
    },
  });

  // IMPORTANT: auth.getUser() çağrısı oturum JWT'sini doğrular ve yeniler
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const path = request.nextUrl.pathname;
  const isPanel = path.startsWith("/panel");
  const isLogin = path === "/login";

  if (isPanel && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }
  if (isLogin && user) {
    const url = request.nextUrl.clone();
    url.pathname = "/panel/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  // güvenlik başlıkları
  response.headers.set("X-Frame-Options", "DENY");
  response.headers.set("X-Content-Type-Options", "nosniff");
  response.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");

  return applyCorsHeaders(response, request);
}

export const config = {
  matcher: [
    "/panel/:path*",
    "/login",
    "/api/v1/:path*",
  ],
};
