import { createAdminClient } from "@/lib/supabase/admin";
import { MockProvider } from "./mock";
import { GatumProvider, type GatumConfig } from "./gatum";
import { GenericHttpProvider, type GenericHttpConfig } from "./http";
import type { ProviderInterface } from "./types";

export * from "./types";
export { MockProvider } from "./mock";
export { GatumProvider } from "./gatum";
export { GenericHttpProvider } from "./http";

// Aktif (is_active) bir sağlayıcı tanımlı mı? Pasifse siparişler "Bekliyor" kalır,
// admin manuel olarak "iletildi" onayı verir.
export async function hasActiveProvider(): Promise<boolean> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("provider_settings")
    .select("id")
    .eq("is_active", true)
    .limit(1);
  return !error && (data?.length ?? 0) > 0;
}

// Aktif sağlayıcıyı provider_settings tablosundan kurar.
// Panel > Entegrasyonlar sekmesinde tanımlanır; kimlik bilgileri AES-256-GCM.
export async function getActiveProvider(): Promise<ProviderInterface> {
  const supabase = createAdminClient();
  // Birden fazla satır yanlışlıkla aktif olsa bile gerçek sağlayıcı (mock değil) tercih edilir;
  // maybeSingle() çoklu satırda hata verip sessizce MockProvider'a düşüyordu.
  const { data: rows, error } = await supabase
    .from("provider_settings")
    .select("*")
    .eq("is_active", true)
    .order("updated_at", { ascending: false })
    .limit(5);
  const data = rows?.find((r) => r.provider !== "mock") ?? rows?.[0] ?? null;

  if (error || !data) return new MockProvider(); // yapılandırma yoksa mock

  const config = (data.config ?? {}) as GenericHttpConfig;
  switch (data.provider) {
    case "gatum":
      return GatumProvider.fromEncrypted({
        baseUrl: data.base_url,
        senderId: data.sender_id,
        credentialsEncrypted: data.credentials_encrypted,
        config: config as unknown as GatumConfig,
      });
    case "http":
      return GenericHttpProvider.fromEncrypted({
        baseUrl: data.base_url,
        senderId: data.sender_id,
        credentialsEncrypted: data.credentials_encrypted,
        config,
      });
    case "mock":
    default:
      return new MockProvider();
  }
}

// Belirli bir sağlayıcıyı (DLR route'u için) adıyla kurar
export async function getProviderByName(name: string): Promise<ProviderInterface | null> {
  if (name === "mock") return new MockProvider();
  const supabase = createAdminClient();
  const { data } = await supabase.from("provider_settings").select("*").eq("provider", name).maybeSingle();
  if (!data) return null;
  const config = (data.config ?? {}) as GenericHttpConfig;
  if (data.provider === "gatum") {
    return GatumProvider.fromEncrypted({
      baseUrl: data.base_url,
      senderId: data.sender_id,
      credentialsEncrypted: data.credentials_encrypted,
      config: config as unknown as GatumConfig,
    });
  }
  return GenericHttpProvider.fromEncrypted({
    baseUrl: data.base_url,
    senderId: data.sender_id,
    credentialsEncrypted: data.credentials_encrypted,
    config,
  });
}
