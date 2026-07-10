import { Hono } from "hono";
import { requireTeam } from "@/server/auth/guards";
import { enforceSessionTenant } from "@/server/auth/session-guard";
import { runWithTenant } from "@/server/auth/tenant-context";
import { brandingAdminRouter, brandingPublicRouter } from "./branding";
import type { ApiDeps, ApiEnv, AuthInstance, GuardSessionData } from "./context";
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

  // Branding (White-Label pflegbar): Admin-Pflege + öffentliches Logo-Serving.
  // Details/Sicherheitsentscheidungen: ./branding.ts
  app.route("/admin/branding", brandingAdminRouter(deps));
  app.route("/branding", brandingPublicRouter(deps));

  // Team-Verwaltung (Phase D): Einladungen + Ownership-Transfer + Audit.
  // /invitations/accept ist BEWUSST nicht public (Session-Pflicht via
  // Default-Deny), aber ohne Team-Gate. Details: ./team.ts
  app.route("/admin/invitations", invitationsAdminRouter(deps));
  app.route("/admin/ownership", ownershipRouter(deps));
  app.route("/invitations", invitationsAcceptRouter(deps));

  // Kommende Feature-Router (werden mit dem jeweiligen Feature implementiert):
  // app.route("/articles", articlesRouter);  // Inhalte pflegen (CRUD, admin-scoped)
  // app.route("/ask", askRouter);            // dynamischen Artikel anfragen (RAG)

  // (5) 404 erst NACH Tenant- und Auth-Prüfung erreichbar (siehe Default-Deny).
  app.notFound((c) => c.json({ error: "not_found" }, 404));
  app.onError((err, c) => {
    console.error("[api] unhandled error:", err);
    return c.json({ error: "internal_error" }, 500);
  });

  return app;
}

/**
 * Default-Instanz für die Next-Route (`src/app/api/v1/[[...route]]/route.ts`):
 * strict-D1-Tenant-Auflösung + D1-better-auth (Details/Dev-Fallback: runtime-deps.ts).
 */
export const app = buildApiApp(runtimeDeps);
