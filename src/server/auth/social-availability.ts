import { getEnvSafe } from "@/server/api/runtime-deps";
import type { SocialProviderId } from "./oauth-gateway";
import { availableSocialProviders, socialProvidersFromEnv } from "./social";

/**
 * Server-seitige Ableitung der verfügbaren Social-Provider für das Auth-UI
 * (Punkt 4a). Liest die Provider-Credentials aus der Cloudflare-Umgebung und
 * gibt nur die vollständig konfigurierten zurück (heute: Google; Microsoft ist
 * ohne Key nicht dabei und wird im UI ausgeblendet).
 *
 * Ohne Cloudflare-Kontext (reines `next dev` ohne Bindings, Tests): leere Liste
 * — dann rendert das UI schlicht keine Social-Buttons (kein Crash, fail-safe).
 */
export async function getAvailableSocialProviders(): Promise<SocialProviderId[]> {
  const env = await getEnvSafe();
  if (!env) return [];
  return availableSocialProviders(socialProvidersFromEnv(env));
}
