import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import type { GuardSessionData } from "@/server/api/context";
import { getEnvSafe } from "@/server/api/runtime-deps";
import type { HelpViewer } from "@/lib/auth/viewer";
import type { Tenant } from "@/lib/tenant/types";
import { evaluateTeamAccess, teamPageDisposition } from "./guards";
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
  /** Rücksprungziel nach einer MFA-Verifikation (Standard: Admin-Start). */
  backTo = "/admin",
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

  // MFA-Sackgasse vermeiden: eigene Session, nur MFA fehlt → zur Einrichtung/
  // Verifikation leiten; alles andere bleibt fail-closed 404 (teamPageDisposition).
  const action = teamPageDisposition(outcome, backTo);
  if (action.kind === "redirect") redirect(action.to);
  if (action.kind === "notFound") notFound();
}

/**
 * AKTUELLER BETRACHTER fürs Endnutzer-Hilfezentrum (Header-Konto-Popup) —
 * reine ANZEIGE-Information, KEIN Gate: `null` heißt schlicht „nicht
 * angemeldet" und die Shell zeigt den Anmelden-Hinweis. Fehler beim Lookup
 * zählen als nicht angemeldet (es hängt kein Privileg daran — jede echte
 * Berechtigung prüfen weiterhin die API-Guards/requireTeamPage).
 */
export async function readPageViewer(tenant: Tenant): Promise<HelpViewer | null> {
  const env = await getEnvSafe();
  if (!env) return null; // DEV ohne Bindings: Auth nicht baubar → anonym.

  const headerList = await headers();
  return runWithTenant(tenant.id, async () => {
    try {
      const auth = await createAuth(env, tenant);
      const data = (await auth.api.getSession({
        headers: headerList as unknown as Headers,
      })) as (GuardSessionData & { user: { email?: string; name?: string | null } }) | null;
      if (!data?.user?.email) return null;
      return {
        name: data.user.name ?? null,
        email: data.user.email,
        role: data.user.role ?? "user",
      };
    } catch {
      return null;
    }
  });
}
