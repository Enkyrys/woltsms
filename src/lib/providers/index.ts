import { createAdminClient } from "@/lib/supabase/admin";
import { MockProvider } from "./mock";
import { GatumProvider } from "./gatum";
import { GenericHttpProvider, type GenericHttpConfig } from "./http";
import type { ProviderInterface } from "./types";

export * from "./types";
export { MockProvider } from "./mock";
export { GatumProvider } from "./gatum";
export { GenericHttpProvider } from "./http";

// Aktif sağlayıcıyı provider_settings tablosundan kurar.
// Panel > Entegrasyonlar sekmesinde tanımlanır; kimlik bilgileri AES-256-GCM.
export async function getActiveProvider(): Promise<ProviderInterface> {
  const supabase = createAdminClient();
  const { data, error } = await supabase
    .from("provider_settings")
    .select("*")
    .eq("is_active", true)
    .maybeSingle();

  if (error || !data) return new MockProvider(); // yapılandırma yoksa mock

  const config = (data.config ?? {}) as GenericHttpConfig;
  switch (data.provider) {
    case "gatum":
      return GatumProvider.fromEncrypted({
        baseUrl: data.base_url,
        senderId: data.sender_id,
        credentialsEncrypted: data.credentials_encrypted,
        config,
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
      config,
    });
  }
  return GenericHttpProvider.fromEncrypted({
    baseUrl: data.base_url,
    senderId: data.sender_id,
    credentialsEncrypted: data.credentials_encrypted,
    config,
  });
}
