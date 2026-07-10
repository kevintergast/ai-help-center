import { AUTH_BASE_PATH } from "@/server/auth/auth";

/**
 * DEFAULT-DENY-ALLOWLIST (Aufgabe 5).
 *
 * JEDE Route unter /api/v1 erfordert eine gültige, tenant-gebundene Session —
 * AUSSER sie steht explizit hier. Neue öffentliche Routen sind eine BEWUSSTE
 * Entscheidung: Liste erweitern + Snapshot-Test in app.security.test.ts
 * aktualisieren (der Test schlägt sonst fehl — genau das ist der Zweck).
 *
 * - exact:    exakter Pfadvergleich (kein Trailing-Slash-Pardon — `/health/`
 *             ist NICHT public, fail-closed).
 * - prefixes: Präfixvergleich für ganze Unterbäume (better-auth-Router).
 *
 * ENTSCHEIDUNG 404 vs. 401 (dokumentiert): Unbekannte, nicht-öffentliche Pfade
 * antworten Anonymen mit 401, NICHT 404 — die Auth-Prüfung läuft VOR dem
 * Routing-Fallback. Damit kann niemand ohne Session die Existenz von Routen
 * ausspähen (kein Route-Probing). Erst MIT gültiger Session liefert ein
 * unbekannter Pfad 404.
 */
export const PUBLIC_ROUTES = {
  // /branding/logo: BEWUSST public — das Hilfezentrum ist öffentlich, das
  // Tenant-Logo muss ohne Session laden (erster Paint, Widget). Liefert NUR
  // das Logo des per Host aufgelösten Tenants (kein User-Input im R2-Key).
  exact: ["/api/v1/health", "/api/v1/tenant", "/api/v1/branding/logo"],
  prefixes: [`${AUTH_BASE_PATH}/`],
} as const;

/** Ist der Request-Pfad öffentlich (kein Session-Zwang)? */
export function isPublicPath(path: string): boolean {
  if ((PUBLIC_ROUTES.exact as readonly string[]).includes(path)) return true;
  return PUBLIC_ROUTES.prefixes.some((prefix) => path.startsWith(prefix));
}
