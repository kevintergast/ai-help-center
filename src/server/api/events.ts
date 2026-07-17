import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { UsageActorType } from "@/server/billing/store";
import type { VisitorIdCodec } from "@/server/security/visitor-id";
import type { ApiDeps, ApiEnv, GuardSessionData } from "./context";
import { allowRequest, clientIp, rateLimited } from "./rate-limit";

/**
 * NUTZUNGS-EVENTS (Infra-Plan Schritt 3) — öffentliche Ingestion.
 *
 * POST /api/v1/events/view {slug}: verbucht einen Artikel-Aufruf (Beacon aus
 * der Artikelseite). BEWUSST fire-and-forget-Semantik: antwortet praktisch
 * immer 204 (sendBeacon kann die Antwort ohnehin nicht lesen) und ist damit
 * weder ein Artikel-Existenz- noch ein Infrastruktur-Orakel. Ohne D1-Bindung
 * (lokales next dev ohne Wrangler) ist die Route ein No-op — Analytics-
 * Ingestion fail-open zu sein ist hier korrekt: es gibt nichts zu schützen,
 * nur zu zählen (im Gegensatz zu Auth/Turnstile, die fail-closed sind).
 *
 * BESUCHER-IDENTITÄT: pseudonymes First-Party-Cookie `hoh_vid` (httpOnly,
 * SameSite=Lax, 13 Monate) — Basis für View-Dedup + MAU. Eingeloggte Nutzer
 * werden über die Session identifiziert (`u:<user_id>`, geräteübergreifend
 * stabil); Team-Rollen zählen als `internal` (0 Credits, kein MAU, im Admin
 * ausblendbar — Architektur-Entscheidung).
 */

const VISITOR_COOKIE = "hoh_vid";
const VISITOR_COOKIE_MAX_AGE_SEC = 395 * 24 * 60 * 60; // 13 Monate (ePrivacy-üblich)

/** Rollen, deren Aufrufe als interne (Team-)Nutzung gelten. */
const TEAM_ROLES = new Set(["content", "admin", "owner"]);

export interface ResolvedActor {
  actorType: UsageActorType;
  visitorId: string;
  userId: string | null;
  /** Cookie neu gesetzt? (nur für anonyme Erstbesucher) */
  setVisitorCookie: string | null;
}

/**
 * Besucher-/Akteur-Auflösung (geteilt von View-Beacon, Feedback UND /ask).
 * Session wird NUR nachgeschlagen, wenn überhaupt ein better-auth-Session-
 * Cookie mitkommt (anonyme Mehrheit zahlt keinen Auth-Roundtrip). Fehler beim
 * Lookup ⇒ anonym (für Analytics unkritisch, es hängt kein Privileg daran).
 *
 * ABUSE-HÄRTUNG: Mit Codec sind Besucher-IDs HMAC-SIGNIERT (per Tenant).
 * Erfundene/rotierte/fremde Cookies verifizieren nicht → gelten als neuer
 * Besucher und bekommen eine frisch SIGNIERTE ID. Massen-Rotation läuft damit
 * zwingend durch die rate-limitierten Endpunkte statt durch Cookie-Fantasie
 * (MAU-/Dedup-Integrität, siehe security/visitor-id.ts).
 *
 * WIDGET-TRANSPORT (`x-hoh-vid`-Header): Im Cross-Site-iframe des Widgets
 * blocken Safari & Co. Third-Party-Cookies — das Widget hält seine (vom
 * Bootstrap-Endpoint ausgestellte, SIGNIERTE) ID deshalb im partitionierten
 * localStorage und sendet sie als Header. NUR mit gültiger Signatur
 * akzeptiert (gefälschte Header zählen wie gefälschte Cookies: neue ID);
 * ohne Codec (dev ohne Secret) wird der Header ignoriert.
 */
export const VISITOR_HEADER = "x-hoh-vid";

export async function resolveActor(
  c: Context<ApiEnv>,
  codec?: VisitorIdCodec,
): Promise<ResolvedActor> {
  const cookieHeader = c.req.header("cookie") ?? "";
  if (cookieHeader.includes("session_token")) {
    try {
      const auth = await c.get("getAuth")();
      const data = (await auth.api.getSession({
        headers: c.req.raw.headers,
      })) as (GuardSessionData & { user: { id?: string } }) | null;
      const userId = data?.user?.id;
      if (userId) {
        const role = data?.user?.role ?? "user";
        return {
          actorType: TEAM_ROLES.has(role) ? "internal" : "user",
          visitorId: `u:${userId}`,
          userId,
          setVisitorCookie: null,
        };
      }
    } catch {
      /* anonym weiterzählen */
    }
  }

  const tenantId = c.get("tenant").id;

  // 1) Header-Transport (Widget) — nur signiert gültig, sonst ignoriert.
  const fromHeader = c.req.header(VISITOR_HEADER);
  if (fromHeader && codec) {
    const valid = await codec.verify(tenantId, fromHeader);
    if (valid) {
      return { actorType: "anon", visitorId: valid, userId: null, setVisitorCookie: null };
    }
  }

  // 2) First-Party-Cookie (Hilfezentrum selbst).
  const existing = getCookie(c, VISITOR_COOKIE);
  if (existing) {
    if (codec) {
      const valid = await codec.verify(tenantId, existing);
      if (valid) {
        return { actorType: "anon", visitorId: valid, userId: null, setVisitorCookie: null };
      }
      // ungültig/gefälscht → unten frisch (signiert) vergeben
    } else if (/^[0-9a-f-]{36}$/.test(existing)) {
      return { actorType: "anon", visitorId: existing, userId: null, setVisitorCookie: null };
    }
  }
  const fresh = codec ? await codec.issue(tenantId) : crypto.randomUUID();
  return { actorType: "anon", visitorId: fresh, userId: null, setVisitorCookie: fresh };
}

/** Frisch vergebene anonyme Besucher-ID als Cookie setzen (geteilt mit /ask). */
export function applyVisitorCookie(c: Context<ApiEnv>, actor: ResolvedActor): void {
  if (!actor.setVisitorCookie) return;
  setCookie(c, VISITOR_COOKIE, actor.setVisitorCookie, {
    httpOnly: true,
    sameSite: "Lax",
    path: "/",
    maxAge: VISITOR_COOKIE_MAX_AGE_SEC,
    secure: new URL(c.req.url).protocol === "https:",
  });
}

export function eventsPublicRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  r.post("/view", async (c) => {
    const done = () => c.body(null, 204);

    // Notbremse gegen Beacon-Flutung (Credits-/MAU-Sabotage): 60/min/IP,
    // tenant-präfixiert. Fail-open ohne Binding (dev/Tests).
    if (!(await allowRequest(deps.rateLimiters?.events, `ev:${c.get("tenant").id}:${clientIp(c)}`))) {
      return rateLimited(c);
    }

    let slug: unknown;
    try {
      slug = ((await c.req.json()) as { slug?: unknown }).slug;
    } catch {
      return done();
    }
    if (typeof slug !== "string" || slug.length === 0 || slug.length > 200) return done();

    const billing = await deps.getBillingDeps?.();
    if (!billing) return done();

    const actor = await resolveActor(c, deps.visitorCodec);
    applyVisitorCookie(c, actor);

    await billing.repo.recordView({
      tenantId: c.get("tenant").id,
      slug,
      actorType: actor.actorType,
      visitorId: actor.visitorId,
      userId: actor.userId,
      nowSec: Math.floor(Date.now() / 1000),
    });
    return done();
  });

  /**
   * POST /events/feedback {slug?, helpful}: „War das hilfreich?" — zu Artikeln
   * (slug) UND KI-Antworten (ohne slug). 0 Credits, kein MAU; 24h-Dedup pro
   * Besucher+Ziel+Richtung im Store. Gleiche fire-and-forget-Semantik wie
   * /view (kein Existenz-Orakel).
   */
  r.post("/feedback", async (c) => {
    const done = () => c.body(null, 204);

    if (!(await allowRequest(deps.rateLimiters?.events, `ev:${c.get("tenant").id}:${clientIp(c)}`))) {
      return rateLimited(c);
    }

    let body: { slug?: unknown; helpful?: unknown };
    try {
      body = (await c.req.json()) as { slug?: unknown; helpful?: unknown };
    } catch {
      return done();
    }
    if (typeof body.helpful !== "boolean") return done();
    const slug =
      typeof body.slug === "string" && body.slug.length > 0 && body.slug.length <= 200
        ? body.slug
        : null;

    const billing = await deps.getBillingDeps?.();
    if (!billing) return done();

    const actor = await resolveActor(c, deps.visitorCodec);
    applyVisitorCookie(c, actor);

    await billing.repo.recordFeedback({
      tenantId: c.get("tenant").id,
      slug,
      helpful: body.helpful,
      actorType: actor.actorType,
      visitorId: actor.visitorId,
      userId: actor.userId,
      nowSec: Math.floor(Date.now() / 1000),
    });
    return done();
  });

  return r;
}
