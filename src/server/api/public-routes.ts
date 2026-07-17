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
  // /events/view: BEWUSST public — der View-Beacon feuert für ANONYME Besucher
  // (der Normalfall des Hilfezentrums). Antwortet immer 204 (kein Orakel),
  // verbucht nur published-Artikel des per Host aufgelösten Tenants und
  // schreibt ausschließlich Zähler/Events (kein privilegierter Effekt).
  // /ask: BEWUSST public — der dynamische KI-Artikel IST das Produkt für
  // anonyme Endnutzer. Missbrauchsschutz in Schichten: IP-Rate-Limit +
  // Besucher-Tagesdeckel + Grounding-Schwelle + Plan-Gate (api/ask.ts,
  // rate-limit.ts) + AI-Gateway (Spend-/Rate-Limit) + WAF.
  // /events/feedback: BEWUSST public — „War das hilfreich?" kommt von anonymen
  // Besuchern; wie /view fire-and-forget (204, kein Orakel), 0 Credits,
  // 24h-Dedup, IP-Rate-Limit.
  // /support/tickets: BEWUSST public — „Etwas stimmt nicht?" ist der Eskala-
  // tionsweg ANONYMER Endnutzer (Architektur Support-Flow). Schichten:
  // IP-Rate-Limit (sensitive), strikte Längen, Mail NUR an die konfigurierte
  // Tenant-Adresse (nie an Nutzer-Input), Inbox als verlustfreier Fallback.
  // /widget/session: BEWUSST public — vergibt dem eingebetteten Widget die
  // signierte Besucher-ID (Cross-Site-iframe kann Cookies nicht lesen).
  // Reine Identitätsvergabe hinter dem events-Rate-Limit; kein privilegierter
  // Effekt (Begründung api/widget.ts).
  // /answers/check: BEWUSST public — Staleness-Prüfung LOKAL gespeicherter
  // KI-Antworten anonymer Nutzer (local-first-Architektur). Reiner Hash-
  // Vergleich gegen VERÖFFENTLICHTE Inhalte (kein Draft-Orakel), hinter dem
  // events-Rate-Limit; der Konto-Sync (/answers CRUD) bleibt session-pflichtig.
  exact: [
    "/api/v1/health",
    "/api/v1/tenant",
    "/api/v1/branding/logo",
    "/api/v1/events/view",
    "/api/v1/events/feedback",
    "/api/v1/ask",
    "/api/v1/support/tickets",
    "/api/v1/widget/session",
    "/api/v1/answers/check",
  ],
  // /api/v1/legal/: BEWUSST public — Besucher müssen Impressum/Datenschutz/AGB
  // OHNE Login lesen können (rechtliche Pflicht). Der /legal-Subbaum ist
  // AUSSCHLIESSLICH öffentliches Lesen (GET /legal/:docType); JEDE Pflege läuft
  // über den getrennten, gegateten /admin/legal-Subbaum (der NICHT mit
  // /api/v1/legal/ beginnt und damit von diesem Prefix NICHT erfasst wird).
  // Analog zur /branding- vs. /admin/branding-Trennung — keine Aufweichung.
  // `${AUTH_BASE_PATH}/` deckt den GESAMTEN better-auth-Subbaum ab — inkl. des
  // Phase-E-Social-Callbacks `/api/v1/auth/callback/:provider` auf dem
  // TENANT-Host: der Provider-Rückweg ist zwangsläufig unauthenticated (der
  // Nutzer kommt ohne Session vom IdP zurück), better-auth validiert dort seine
  // eigene state-Cookie + Verification-Zeile (CSRF-Anker). Es ist deshalb KEIN
  // neuer Allowlist-Eintrag nötig und KEINE Aufweichung — der Callback war schon
  // immer Teil des public Auth-Prefixes. Der GATEWAY-Callback (auf
  // auth.hallofhelp.com) läuft ohnehin VOR dieser Default-Deny-Schicht
  // (app.ts (0b), host-diskriminiert) und erreicht sie nie.
  // /api/v1/content/images/: BEWUSST public — Bilder VERÖFFENTLICHTER Artikel
  // müssen ohne Session laden (öffentliches Hilfezentrum, <img>-Tags senden
  // keine Custom-Header). Fail-closed: ausgeliefert wird nur, was zu einem
  // published-Artikel DES Host-Tenants gehört (Draft-Bilder nie; Key wird
  // serverseitig abgeleitet) — s. contentImagesPublicRouter.
  prefixes: [`${AUTH_BASE_PATH}/`, "/api/v1/legal/", "/api/v1/content/images/"],
} as const;

/** Ist der Request-Pfad öffentlich (kein Session-Zwang)? */
export function isPublicPath(path: string): boolean {
  if ((PUBLIC_ROUTES.exact as readonly string[]).includes(path)) return true;
  return PUBLIC_ROUTES.prefixes.some((prefix) => path.startsWith(prefix));
}
