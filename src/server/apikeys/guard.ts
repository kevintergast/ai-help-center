import type { Context, Next } from "hono";
import type { ApiEnv } from "@/server/api/context";
import { hasScope, type ApiScope } from "./scopes";

/**
 * SCOPE-GATE für schlüssel-authentifizierte Routen — das Gegenstück zu
 * `requireTeam` (auth/guards.ts) auf dem Maschinen-Pfad.
 *
 * Prüfreihenfolge (fixiert, Tests asserten sie):
 *   1. kein Key-Prinzipal am Request ..... 401 unauthorized
 *      (die Default-Deny-Schicht hat ihn gesetzt oder eben nicht)
 *   2. Scope fehlt ....................... 403 insufficient_scope
 *
 * Der 403 trägt einen `WWW-Authenticate`-Header mit dem benötigten Scope, wie
 * ihn die MCP-Autorisierung vorsieht (RFC 6750 §3.1) — ein OAuth-Client kann
 * daraus direkt eine Step-up-Autorisierung bauen, ohne raten zu müssen.
 *
 * WICHTIG: Dieses Gate ist die EINZIGE Autorität für Scopes. Dass die
 * MCP-Werkzeugliste gesperrte Tools gar nicht erst zeigt, ist Ergonomie —
 * kein Schutz. Beide Wege werden getrennt getestet.
 */
export function requireScope(scope: ApiScope) {
  return async (c: Context<ApiEnv>, next: Next) => {
    const principal = c.get("apiKey");
    if (!principal) return c.json({ error: "unauthorized" }, 401);

    if (!hasScope(principal.scopes, scope)) {
      return c.json({ error: "insufficient_scope", requiredScope: scope }, 403, {
        "WWW-Authenticate": `Bearer error="insufficient_scope", scope="${scope}"`,
      });
    }
    return next();
  };
}
