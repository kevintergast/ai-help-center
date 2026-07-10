import type { Context, Next } from "hono";
import type { ApiEnv, GuardSessionData } from "@/server/api/context";
import { hasAtLeast } from "./access-control";
import { enforceSessionTenant } from "./session-guard";

/**
 * ROLLEN-/MFA-GUARDS für Team-Bereiche der API (Aufgabe 4).
 *
 * Prüfreihenfolge (bewusst fixiert, Tests asserten sie exakt):
 *   1. keine (lesbare) Session ................ 401 unauthorized
 *   2. Session gehört nicht zum Tenant ........ 401 unauthorized
 *      (enforceSessionTenant; Defense-in-Depth zusätzlich zum Adapter-Scoping)
 *   3. user.twoFactorEnabled falsy ............ 403 mfa_setup_required
 *   4. session.mfaVerified falsy .............. 403 mfa_verification_required
 *   5. rank(user.role) < rank(min) ............ 403 forbidden
 *
 * WICHTIG (Phase B): Das two-factor-Plugin kommt erst in Phase C. Bis dahin ist
 * `user.twoFactorEnabled` für JEDEN User undefined → Schritt 3 blockiert alle
 * Team-Routen mit `mfa_setup_required`. Das ist BEABSICHTIGT (kein Team-Zugriff
 * ohne MFA, niemals) und darf nicht aufgeweicht werden, damit etwas "schon mal
 * funktioniert".
 *
 * Die better-auth-Instanz wird über die Context-Variable `getAuth` geteilt
 * (per-Request memoisiert in der Tenant-Middleware) — hier wird NICHTS doppelt
 * gebaut. Fehler beim Session-Lookup werden als "keine Session" behandelt
 * (fail-closed → 401, nie ein Durchlass).
 */

/** Fehlerantworten als maschinenlesbare, stabile Codes (bewusst Englisch). */
const UNAUTHORIZED = { error: "unauthorized" } as const;

export function requireTeam(min: "content" | "admin" | "owner") {
  return async (c: Context<ApiEnv>, next: Next): Promise<Response | void> => {
    let data: GuardSessionData | null = null;
    try {
      const auth = await c.get("getAuth")();
      data = (await auth.api.getSession({
        headers: c.req.raw.headers,
      })) as GuardSessionData | null;
    } catch {
      // Lookup-/Infrastrukturfehler => wie "keine Session" behandeln (deny).
      data = null;
    }

    if (!data) return c.json(UNAUTHORIZED, 401);

    // Tenant-Bindung der Session erzwingen (401 statt 403: für Fremd-Sessions
    // verhalten wir uns wie "nicht eingeloggt", keine Existenz-Orakel).
    const session = enforceSessionTenant(data.session);
    if (!session) return c.json(UNAUTHORIZED, 401);

    if (!data.user.twoFactorEnabled) {
      return c.json({ error: "mfa_setup_required" }, 403);
    }
    if (!session.mfaVerified) {
      return c.json({ error: "mfa_verification_required" }, 403);
    }
    if (!hasAtLeast(data.user.role, min)) {
      return c.json({ error: "forbidden" }, 403);
    }

    await next();
  };
}

/** Höchste Stufe: nur der Instanz-Eigentümer. */
export const requireOwner = requireTeam("owner");

/**
 * STEP-UP-GUARD (Phase C, M-5): verlangt ein FRISCHES Zweitfaktor-Verify.
 *
 * `session.mfaVerifiedAt` (Unix-Epoche, Sekunden) wird ausschließlich bei einem
 * echten Verify-Event gesetzt/aufgefrischt (mfa-policy.ts). Dieser Guard prüft,
 * dass das letzte Verify höchstens `maxAgeSec` zurückliegt — für sensible
 * Aktionen (Owner-Transfer, Rollenwechsel, MFA-Änderungen; Phase D/E).
 *
 * Fail-closed: keine Session → 401; fehlender/alter Marker → 403
 * `mfa_stepup_required`. Läuft NACH requireTeam gedacht, funktioniert aber auch
 * alleinstehend (eigener Session-Lookup, keine versteckte Reihenfolge-Abhängigkeit).
 */
export function requireFreshMfa(maxAgeSec = 300) {
  return async (c: Context<ApiEnv>, next: Next): Promise<Response | void> => {
    let data: GuardSessionData | null = null;
    try {
      const auth = await c.get("getAuth")();
      data = (await auth.api.getSession({
        headers: c.req.raw.headers,
      })) as GuardSessionData | null;
    } catch {
      data = null;
    }
    if (!data) return c.json(UNAUTHORIZED, 401);

    const session = enforceSessionTenant(data.session);
    if (!session) return c.json(UNAUTHORIZED, 401);

    const verifiedAt = session.mfaVerifiedAt;
    const fresh =
      !!session.mfaVerified &&
      typeof verifiedAt === "number" &&
      Math.floor(Date.now() / 1000) - verifiedAt <= maxAgeSec;
    if (!fresh) {
      return c.json({ error: "mfa_stepup_required" }, 403);
    }

    await next();
  };
}
