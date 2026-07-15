import { readSecretValue, type SecretLike } from "@/server/auth/secret";

/**
 * Cloudflare-for-SaaS-Anbindung: legt nach erfolgreicher TXT-Verifikation den
 * Custom Hostname in unserer Zone an (TLS-Zertifikat + Routing für die
 * Kunden-Domain).
 *
 * BEWUSST BEST-EFFORT + INERT OHNE KONFIG (Resend-Muster): Ohne
 * `CF_SAAS_API_TOKEN`/`CF_ZONE_ID` liefert der Provisioner "skipped" — die
 * Domain ist dann VERIFIZIERT (App-seitige Auflösung funktioniert), wird aber
 * erst nach dem User-Setup (scoped API-Token mit "SSL and Certificates: Edit"
 * + Fallback-Origin in der Zone) auch tatsächlich ausgeliefert. Der
 * Verify-Endpoint reicht das Ergebnis transparent an die UI durch.
 */

export type ProvisionResult = "provisioned" | "skipped" | "failed";

export type CustomHostnameProvisioner = (domain: string) => Promise<ProvisionResult>;

export interface ProvisionerEnv {
  CF_SAAS_API_TOKEN?: SecretLike;
  CF_ZONE_ID?: string;
}

const API_BASE = "https://api.cloudflare.com/client/v4";
const PROVISION_TIMEOUT_MS = 15_000;

export function makeCustomHostnameProvisioner(
  env: ProvisionerEnv,
  fetchImpl: typeof fetch = fetch,
): CustomHostnameProvisioner {
  return async (domain) => {
    const token = await readSecretValue(env.CF_SAAS_API_TOKEN);
    const zoneId = env.CF_ZONE_ID;
    if (!token || !zoneId) return "skipped";

    try {
      const res = await fetchImpl(`${API_BASE}/zones/${zoneId}/custom_hostnames`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ hostname: domain, ssl: { method: "http", type: "dv" } }),
        signal: AbortSignal.timeout(PROVISION_TIMEOUT_MS),
      });
      if (res.ok) return "provisioned";
      // Bereits vorhandener Hostname (Re-Verify) ist kein Fehler.
      const body = (await res.json().catch(() => null)) as {
        errors?: { code?: number }[];
      } | null;
      if (body?.errors?.some((e) => e.code === 1407 || e.code === 1406)) return "provisioned";
      return "failed";
    } catch {
      return "failed";
    }
  };
}
