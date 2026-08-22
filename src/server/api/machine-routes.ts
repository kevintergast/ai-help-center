/**
 * MASCHINEN-PFADE — Gegenstück zur Public-Allowlist (public-routes.ts).
 *
 * Auf diesen Pfaden gilt ein API-Key als Credential. Und zwar AUSSCHLIESSLICH
 * er: eine Cookie-Session wird hier NICHT akzeptiert.
 *
 * WARUM BEARER-ONLY (tragende Entscheidung, docs/mcp-plan.md §4 E7):
 * Ein Cookie ist ein *ambientes* Credential — der Browser schickt es mit, ohne
 * dass jemand es beabsichtigt. Eine fremde Website könnte den MCP-Endpoint
 * sonst im Browser des eingeloggten Kunden fahren (CSRF), und zwar mit dessen
 * vollen Rechten. Ein Bearer-Header wird nie automatisch mitgeschickt: wer ihn
 * setzt, will es. Erst dadurch dürfen wir CORS für Browser-Clients öffnen
 * (ohne `Access-Control-Allow-Credentials`) — mit Cookie-Auth wäre das ein Loch.
 *
 * WARUM EINE ALLOWLIST statt „Bearer gilt überall":
 * Mehrere Routen verlassen sich für ihre Session-Prüfung auf die Default-Deny-
 * Schicht (z. B. /answers, /operator). Würde ein Schlüssel dort generell als
 * „authentifiziert" durchgehen, wären sie mit einem Schlag erreichbar. Der
 * Schlüssel öffnet deshalb nur Türen, die hier ausdrücklich genannt sind.
 * Erweiterung = bewusste Entscheidung + Snapshot-Test in app.security.test.ts.
 */
export const MACHINE_ROUTES = {
  /** MCP-Endpoint (JSON-RPC). Ein Pfad, kein Unterbaum. */
  exact: ["/api/v1/mcp"],
} as const;

/** Gilt auf diesem Pfad der API-Key (und NUR er)? */
export function isMachinePath(path: string): boolean {
  return (MACHINE_ROUTES.exact as readonly string[]).includes(path);
}
