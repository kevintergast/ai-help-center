import { headers } from "next/headers";
import type { Tenant } from "@/lib/tenant/types";
import { createAuth } from "@/server/auth/runtime";
import { enforceSessionTenant } from "@/server/auth/session-guard";
import { runWithTenant } from "@/server/auth/tenant-context";
import { getEnvSafe } from "@/server/api/runtime-deps";

/**
 * SEITEN-GATE der Operator-Konsole (Punkt 4b, Next Server Components).
 *
 * Spiegelt die serverseitige Session-Lesefläche der Operator-API (kein Team-
 * Gate, KEINE MFA-Pflicht — Operator-Konten sind normale `user` im Tenant
 * `t_operator`, nicht Team-Rollen; MFA für Operator ist im MVP bewusst NICHT
 * erzwungen). Liefert den eingeloggten Operator-User ODER `null` (→ die Seite
 * zeigt den Anmelde-Prompt statt echter Daten).
 *
 * DEV-FALLBACK (kein Cloudflare-Kontext): Auth ist ohne Bindings nicht baubar →
 * `null` (Anmelde-Prompt). Im deployten Worker ist die DB-Bindung immer da.
 */
export interface OperatorPageUser {
  id: string;
  email: string;
  name: string | null;
  emailVerified: boolean;
}

export async function readOperatorPageUser(tenant: Tenant): Promise<OperatorPageUser | null> {
  const env = await getEnvSafe();
  if (!env) return null; // DEV-ONLY: keine echte Auth ohne Bindings.

  const headerList = await headers();
  return runWithTenant(tenant.id, async () => {
    try {
      const auth = await createAuth(env, tenant);
      const data = (await auth.api.getSession({
        headers: headerList as unknown as Headers,
      })) as {
        session: { tenantId?: string | null };
        user: { id: string; email: string; name?: string | null; emailVerified?: boolean | null };
      } | null;
      if (!data || !enforceSessionTenant(data.session)) return null;
      return {
        id: data.user.id,
        email: data.user.email,
        name: data.user.name ?? null,
        emailVerified: data.user.emailVerified === true,
      };
    } catch {
      return null;
    }
  });
}
