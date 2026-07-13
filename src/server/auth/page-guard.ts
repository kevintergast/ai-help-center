import { headers } from "next/headers";
import { notFound } from "next/navigation";
import type { GuardSessionData } from "@/server/api/context";
import { getEnvSafe } from "@/server/api/runtime-deps";
import type { Tenant } from "@/lib/tenant/types";
import { evaluateTeamAccess } from "./guards";
import { createAuth } from "./runtime";
import { runWithTenant } from "./tenant-context";

/**
 * SERVERSEITIGE SEITEN-GATE fürs Betreiber-/Admin-UI (Next Server Components).
 *
 * Das Content-Backend ist auf DB-/API-Ebene isoliert und gegated; die Next-
 * Seiten unter `src/app/admin/*` lesen aber ECHTE D1-Daten über ALLE Status
 * (inkl. `draft`) und dürfen daher NICHT ungeschützt rendern — sonst leakt ein
 * anonymer Besucher Entwürfe/unveröffentlichte Inhalte. Diese Gate spiegelt die
 * API-Guard-Kette (`requireTeam`) exakt über die geteilte `evaluateTeamAccess`:
 * Session vorhanden → tenant-gebunden → MFA (setup+verify) → Rolle ≥ min. Bei
 * Verstoß: `notFound()` (fail-closed, kein Existenz-Orakel, keine Login-Route).
 *
 * DEV-FALLBACK (kein Cloudflare-Kontext, `env == null`): Auth ist ohne Bindings
 * nicht baubar, UND der Content-Runtime liefert in diesem Fall ausschließlich
 * Sample-Daten (keine echten Tenant-Drafts, src/server/content/runtime.ts). Es
 * gibt also nichts Echtes zu schützen → kein Gate, analog zur Demo-Tenant-
 * Registry. Im deployten Worker ist die DB-Bindung IMMER vorhanden, dort greift
 * die Gate deshalb ausnahmslos.
 */
export async function requireTeamPage(
  tenant: Tenant,
  min: "content" | "admin" | "owner",
): Promise<void> {
  const env = await getEnvSafe();
  if (!env) return; // DEV-ONLY: Sample-Fallback, keine echten Daten (s. o.).

  const headerList = await headers();
  const outcome = await runWithTenant(tenant.id, async () => {
    let data: GuardSessionData | null = null;
    try {
      const auth = await createAuth(env, tenant);
      data = (await auth.api.getSession({
        headers: headerList as unknown as Headers,
      })) as GuardSessionData | null;
    } catch {
      // Lookup-/Infrastrukturfehler ⇒ wie "keine Session" behandeln (deny).
      data = null;
    }
    return evaluateTeamAccess(data, min);
  });

  if (!outcome.ok) notFound();
}
