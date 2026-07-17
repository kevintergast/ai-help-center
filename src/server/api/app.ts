import { Hono } from "hono";
import type { Tenant } from "@/lib/tenant/types";
import { requireTeam } from "@/server/auth/guards";
import { allowRequest, clientIp, rateLimited } from "./rate-limit";
import {
  handleGatewayCallback,
  isGatewayHost,
  type OAuthGatewayDeps,
  tenantInitiatingOrigin,
  wrapAuthorizationURL,
} from "@/server/auth/oauth-gateway";
import { enforceSessionTenant } from "@/server/auth/session-guard";
import { runWithTenant } from "@/server/auth/tenant-context";
import { freezeGate } from "@/server/billing/enforcement";
import { answersRouter } from "./answers";
import { askPublicRouter } from "./ask";
import { brandingAdminRouter, brandingPublicRouter } from "./branding";
import { contentAdminRouter, contentImagesPublicRouter } from "./content";
import type { ApiDeps, ApiEnv, AuthInstance, GuardSessionData } from "./context";
import { domainAdminRouter } from "./domain";
import { eventsPublicRouter } from "./events";
import { legalAdminRouter, legalPublicRouter } from "./legal";
import { settingsAdminRouter } from "./settings";
import { supportAdminRouter, supportPublicRouter } from "./support";
import { widgetPublicRouter } from "./widget";
import { operatorRouter } from "./operator";
import { isPublicPath } from "./public-routes";
import { runtimeDeps } from "./runtime-deps";
import { invitationsAcceptRouter, invitationsAdminRouter, ownershipRouter } from "./team";

/**
 * Öffentliche, versionierte API (`/api/v1`) — das gemeinsame Backend für
 * Frontend, Admin, einbettbares Widget und Voice-Bots.
 *
 * Läuft heute im selben Next.js/OpenNext-Worker (ein Deploy), ist aber als
 * eigenständige Hono-App gekapselt und damit später in einen dedizierten
 * Worker extrahierbar, ohne die Aufrufer zu ändern.
 *
 * MIDDLEWARE-/ROUTEN-REIHENFOLGE (tragend, nicht umsortieren):
 *
 *   0. GET /health              — VOR der Tenant-Middleware registriert:
 *                                 Liveness darf nicht von Tenant-Auflösung/D1
 *                                 abhängen (sonst wäre ein DB-Ausfall auch ein
 *                                 Healthcheck-Ausfall). Kein Tenant-Bezug,
 *                                 keine Daten. Public per Allowlist.
 *   1. Tenant-Middleware (*)    — strict: unbekannter Host → 404 fail-closed.
 *                                 Setzt `tenant` + memoisierten `getAuth`-Getter
 *                                 und führt `await next()` INNERHALB von
 *                                 `runWithTenant(...)` aus: die AsyncLocalStorage-
 *                                 Boundary umschließt damit JEDEN downstream-Code
 *                                 (inkl. better-auth-Adapter). Es gibt keinen
 *                                 zweiten Tenant-Kanal.
 *   2. Default-Deny (*)         — nicht-public + keine tenant-gebundene Session
 *                                 → 401. Läuft VOR jedem Routing-Treffer und vor
 *                                 notFound (unbekannte Pfade → 401 für Anonyme,
 *                                 404 erst mit Session — kein Route-Probing;
 *                                 Begründung in public-routes.ts).
 *   3. /auth/* (GET+POST)       — better-auth-HTTP-Mount (per-Request-Instanz
 *                                 aus `getAuth`, basePath /api/v1/auth).
 *   4. Fach-Routen              — /tenant (public), /admin/ping (requireTeam).
 *   5. notFound/onError         — JSON-Fehler; erreichbar erst NACH 1+2.
 */

export function buildApiApp(deps: ApiDeps) {
  const app = new Hono<ApiEnv>().basePath("/api/v1");

  // (0) Liveness — bewusst VOR der Tenant-Middleware (siehe Kopfkommentar).
  app.get("/health", (c) => c.json({ status: "ok", service: "hallofhelp-api", version: "v1" }));

  // (0b) OAUTH-GATEWAY (Phase E, §c-3): NUR auf dem zentralen, tenant-freien
  // Host `auth.hallofhelp.com`. Läuft VOR der Tenant-Middleware — der Gateway
  // löst den Tenant NICHT über den Host, sondern aus dem signierten `state` auf
  // und leitet den Provider-Callback per 302 an die initiierende Tenant-Origin
  // weiter (kein DB-Insert hier). Auf allen anderen Hosts fällt die Middleware
  // sofort durch (`next()`), sodass Tenant-Hosts (inkl. ihr eigener
  // `/auth/callback/*`) unverändert weiterlaufen.
  app.use("*", async (c, next) => {
    if (!isGatewayHost(c.req.header("host"))) return next();
    // Der Gateway-Host bedient AUSSCHLIESSLICH GET /api/v1/auth/callback/:provider.
    const m = /^\/api\/v1\/auth\/callback\/([^/]+)$/.exec(c.req.path);
    if (!m || c.req.method !== "GET") return c.json({ error: "not_found" }, 404);
    if (!deps.oauthGateway) return c.json({ error: "oauth_gateway_unconfigured" }, 503);
    return handleGatewayCallback(c.req.raw, m[1], deps.oauthGateway);
  });

  // (1) Tenant-Grenze = ALS-Boundary.
  app.use("*", async (c, next) => {
    const tenant = await deps.resolveTenant(c.req.header("host"));
    if (!tenant) {
      // Fail-closed: unbekannte Instanz → 404, KEIN Demo-/Default-Fallback.
      return c.json({ error: "unknown_tenant" }, 404);
    }
    c.set("tenant", tenant);

    // Per-Request memoisierte Auth-Instanz: Auth-Mount, Default-Deny und
    // Guards teilen sich EIN Exemplar (kein Doppelbau, keine Drift).
    let authPromise: Promise<AuthInstance> | null = null;
    c.set("getAuth", () => (authPromise ??= deps.createAuthForTenant(tenant)));

    // ALLES Downstream (inkl. better-auth-Adapter) läuft im Tenant-Kontext.
    await runWithTenant(tenant.id, () => next());
  });

  // (2) DEFAULT-DENY: ohne gültige, tenant-gebundene Session ist JEDE
  // nicht-öffentliche Route (auch eine unbekannte) 401.
  app.use("*", async (c, next) => {
    if (isPublicPath(c.req.path)) return next();

    let data: GuardSessionData | null = null;
    try {
      const auth = await c.get("getAuth")();
      data = (await auth.api.getSession({
        headers: c.req.raw.headers,
      })) as GuardSessionData | null;
    } catch {
      // Infrastruktur-/Lookup-Fehler zählt als "keine Session" (fail-closed).
      data = null;
    }

    // Tenant-Bindung erzwingen: eine Session des falschen Tenants ist hier
    // schlicht "keine Session" (Defense-in-Depth zum Adapter-Scoping).
    if (!data || !enforceSessionTenant(data.session)) {
      return c.json({ error: "unauthorized" }, 401);
    }
    return next();
  });

  // (3-vor) IP-RATE-LIMIT auf MAIL-SENDENDE Auth-Endpunkte (Abuse-Härtung):
  // Turnstile verhindert dort Bots, das Limit zusätzlich Mail-Bombing auf
  // fremde Adressen + Resend-Kosten/Reputationsschaden durch Wiederholung
  // (5/min/IP; fail-open ohne Binding, s. rate-limit.ts).
  const MAIL_SENDING_AUTH_PATHS = new Set([
    "sign-up/email",
    "request-password-reset",
    "send-verification-email",
    "two-factor/send-otp",
  ]);
  app.use("/auth/*", async (c, next) => {
    if (c.req.method === "POST") {
      const sub = c.req.path.split("/auth/")[1] ?? "";
      if (MAIL_SENDING_AUTH_PATHS.has(sub)) {
        const ok = await allowRequest(
          deps.rateLimiters?.sensitive,
          `mail:${c.get("tenant").id}:${clientIp(c)}`,
        );
        if (!ok) return rateLimited(c);
      }
    }
    return next();
  });

  // (3a) SIGN-IN-START Social (Phase E, §c-3): better-auth erzeugt im
  // Nicht-idToken-Zweig eine Authorization-URL, deren `redirect_uri` (via
  // socialProviders.*.redirectURI) bereits auf den zentralen Gateway zeigt,
  // deren `state` aber sein eigener roher 32-Zeichen-Wert ist. Damit der Gateway
  // den Provider-Callback dem richtigen Tenant zuordnen kann, MUSS dieser äußere
  // state VOR der Weiterleitung an den IdP durch den signierten Gateway-Umschlag
  // ersetzt werden (wrapAuthorizationURL). Diese spezifische Route ist bewusst
  // VOR dem generischen /auth/*-Mount registriert (spezifischer Pfad gewinnt).
  app.post("/auth/sign-in/social", async (c) => {
    const auth = await c.get("getAuth")();
    const res = await auth.handler(c.req.raw);
    return wrapSocialSignIn(res, c.get("tenant"), deps.oauthGateway ?? null);
  });

  // (3) better-auth-HTTP-Mount: /api/v1/auth/* (GET+POST). Der interne Router
  // matcht dank basePath "/api/v1/auth" (tenantAuthOptions) auf den Raw-Request.
  app.on(["GET", "POST"], "/auth/*", async (c) => {
    const auth = await c.get("getAuth")();
    return auth.handler(c.req.raw);
  });

  // TODO (mit der Public-API-Freigabe): API-Key-Auth-Middleware + CORS (hono/cors)
  //       für cross-origin Zugriff durch Widget/Voice/Drittsysteme.

  // (4) Aktuellen Mandanten (mandantensicher aus dem Host aufgelöst) zurückgeben.
  app.get("/tenant", (c) => {
    const t = c.get("tenant");
    return c.json({
      id: t.id,
      slug: t.slug,
      name: t.name,
      defaultLocale: t.defaultLocale,
      branding: t.branding,
    });
  });

  // Beispiel-geschützte Route: Platzhalter der kommenden Admin-API, beweist die
  // komplette Guard-Kette (Session → Tenant → MFA → Rolle) in Tests.
  app.get("/admin/ping", requireTeam("admin"), (c) =>
    c.json({ pong: true, tenantId: c.get("tenant").id }),
  );

  // FREEZE-GATE (Infra-Plan Schritt 4): nach abgelaufener Grace sind Inhalts-/
  // Branding-MUTATIONEN 402 (Lesen bleibt frei; Team/Legal/Plan bewusst offen).
  // Registriert VOR den Fach-Routern; Anonyme sind durch (2) längst 401.
  // Beide Muster je Subbaum: der NACKTE Pfad (POST /admin/articles = Create)
  // wird von einem Trailing-`/*` allein nicht sicher erfasst.
  const contentFreeze = freezeGate(deps);
  app.use("/admin/articles", contentFreeze);
  app.use("/admin/articles/*", contentFreeze);
  app.use("/admin/branding", contentFreeze);
  app.use("/admin/branding/*", contentFreeze);

  // Branding (White-Label pflegbar): Admin-Pflege + öffentliches Logo-Serving.
  // Details/Sicherheitsentscheidungen: ./branding.ts
  app.route("/admin/branding", brandingAdminRouter(deps));
  app.route("/branding", brandingPublicRouter(deps));

  // Legal-Docs pro Instanz (Design h): owner-exklusive Pflege + admin-Lesen +
  // öffentliches Ausliefern (Impressum/Datenschutz ohne Login). Details/
  // Sicherheitsentscheidungen (owner vs admin, XSS): ./legal.ts
  app.route("/admin/legal", legalAdminRouter(deps));
  app.route("/legal", legalPublicRouter(deps));

  // Instanz-Einstellungen (owner-only, aktuell SEO-Opt-out).
  app.route("/admin/settings", settingsAdminRouter(deps));

  // Support-Flow: public Ticket-Einreichung + Admin-Inbox.
  app.route("/support", supportPublicRouter(deps));
  app.route("/admin/support", supportAdminRouter(deps));

  // Gespeicherte KI-Antworten: /answers/check public (Staleness, anonyme
  // local-first-Nutzer), Rest session-pflichtig (Konto-Sync).
  app.route("/answers", answersRouter(deps));

  // Widget-Bootstrap (signierte Besucher-ID für den iframe-Transport).
  app.route("/widget", widgetPublicRouter(deps));

  // Team-Verwaltung (Phase D): Einladungen + Ownership-Transfer + Audit.
  // /invitations/accept ist BEWUSST nicht public (Session-Pflicht via
  // Default-Deny), aber ohne Team-Gate. Details: ./team.ts
  app.route("/admin/invitations", invitationsAdminRouter(deps));
  app.route("/admin/ownership", ownershipRouter(deps));
  app.route("/invitations", invitationsAcceptRouter(deps));

  // Content-Pflege (Punkt 2): Artikel-CRUD + Lifecycle, requireTeam("content").
  // Tenant-scoped; ohne D1-Binding 503. Details/Sicherheit: ./content.ts
  app.route("/admin/articles", contentAdminRouter(deps));
  // Artikel-Bilder public (nur published-Artikel, s. contentImagesPublicRouter).
  app.route("/content/images", contentImagesPublicRouter(deps));

  // Nutzungs-Events (Infra-Plan Schritt 3): public View-Beacon-Ingestion
  // (immer 204, No-op ohne D1). Details/Cookie-Semantik: ./events.ts
  app.route("/events", eventsPublicRouter(deps));

  // Custom-Domain-Flow (Infra-Plan Schritt 5): TXT-Verify + SaaS-Provisioning.
  // Auflösung bleibt fail-closed auf status='verified'. Details: ./domain.ts
  app.route("/admin/domain", domainAdminRouter(deps));

  // Operator-Onboarding (Punkt 4b): Provisioning der Betreiber-Control-Plane.
  // NUR im Operator-Kontext (t_operator / app.hallofhelp.com) wirksam — auf
  // Kunden-Hosts antwortet jede Route 404 (ensureOperatorContext). Session-
  // Pflicht via Default-Deny; ohne Operator-Bindings 503. Details: ./operator.ts
  app.route("/operator", operatorRouter(deps));

  // Dynamischer KI-Artikel (RAG-Kern, Punkt 3): public Frage-Endpoint.
  // Pipeline/Invarianten (frozen-Gate, Grounding, Credits): server/rag/ask.ts
  app.route("/ask", askPublicRouter(deps));

  // (5) 404 erst NACH Tenant- und Auth-Prüfung erreichbar (siehe Default-Deny).
  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error("[api] unhandled error:", err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}

/**
 * Wickelt (falls vorhanden) die von better-auth erzeugte Authorization-URL des
 * Social-Sign-in-Starts in den signierten Gateway-Umschlag (§c-3).
 *
 * - idToken-Direktlogin: die Antwort trägt KEINE `url` → unverändert
 *   durchgereicht (Session ist bereits erstellt, kein Redirect zum IdP).
 * - Authorization-Code-Start: die Antwort trägt eine `url` (und ggf. einen
 *   `Location`-Header). Nur deren `state`-Query wird durch den Umschlag ersetzt;
 *   better-auths tenant-seitige state-Cookie + verification-Zeile (der eigentliche
 *   CSRF-Anker, host-scoped auf die Tenant-Origin) bleiben UNANGETASTET — der
 *   Gateway packt den inneren state wieder aus, bevor er an die Tenant-Origin
 *   weiterleitet, wo der Code-Exchange abschließt.
 * - Ohne konfigurierten Gateway ist ein echter Redirect-Start Fehlkonfiguration
 *   → 503 (fail-closed). Der roundtrip-freie idToken-Pfad bleibt davon unberührt.
 */
async function wrapSocialSignIn(
  res: Response,
  tenant: Tenant,
  gateway: OAuthGatewayDeps | null,
): Promise<Response> {
  if (!(res.headers.get("content-type") ?? "").includes("application/json")) return res;

  let body: Record<string, unknown>;
  try {
    body = (await res.clone().json()) as Record<string, unknown>;
  } catch {
    return res;
  }

  const url = body.url;
  if (typeof url !== "string" || url.length === 0) return res; // idToken-Zweig: nichts zu wrappen

  if (!gateway) {
    return new Response(JSON.stringify({ error: "oauth_gateway_unconfigured" }), {
      status: 503,
      headers: { "content-type": "application/json" },
    });
  }

  const secret = await gateway.getSecret();
  const wrappedUrl = await wrapAuthorizationURL(url, {
    secret,
    tenantId: tenant.id,
    initiatingOrigin: tenantInitiatingOrigin(tenant.slug),
    nonceStore: gateway.nonceStore,
  });
  body.url = wrappedUrl;

  // Header 1:1 übernehmen — inkl. ALLER Set-Cookie (die better-auth-state-Cookie
  // ist der CSRF-Anker, sie DARF nicht verloren gehen). getSetCookie() gibt die
  // einzelnen Cookies verlustfrei zurück (im Gegensatz zum kommagejointen Copy).
  const headers = new Headers();
  res.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    headers.set(key, value);
  });
  for (const cookie of res.headers.getSetCookie()) headers.append("set-cookie", cookie);
  if (headers.has("location")) headers.set("location", wrappedUrl);
  headers.set("content-type", "application/json");
  headers.delete("content-length"); // Body-Länge hat sich geändert.

  return new Response(JSON.stringify(body), {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
}

/**
 * Default-Instanz für die Next-Route (`src/app/api/v1/[[...route]]/route.ts`):
 * strict-D1-Tenant-Auflösung + D1-better-auth (Details/Dev-Fallback: runtime-deps.ts).
 */
export const app = buildApiApp(runtimeDeps);
