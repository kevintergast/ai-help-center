import { Hono, type Context } from "hono";
import type { UsageActorType } from "@/server/billing/store";
import { periodOf } from "@/server/billing/pricing";
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
 * BESUCHER-IDENTITÄT: OHNE COOKIE. Die pseudonyme ID wird pro Request
 * serverseitig aus Adresse + User-Agent + Periode abgeleitet (siehe
 * security/visitor-id.ts) — es wird nichts im Endgerät abgelegt und nichts
 * davon gespeichert, nur der Hash. Damit braucht keine Instanz ein
 * Einwilligungs-Banner für die Zählung. Eingeloggte Nutzer werden weiterhin
 * über die Session identifiziert (`u:<user_id>`, geräteübergreifend stabil);
 * Team-Rollen zählen als `internal` (0 Credits, kein MAU, im Admin
 * ausblendbar — Architektur-Entscheidung).
 */

/** Rollen, deren Aufrufe als interne (Team-)Nutzung gelten. */
const TEAM_ROLES = new Set(["content", "admin", "owner"]);

export interface ResolvedActor {
  actorType: UsageActorType;
  visitorId: string;
  userId: string | null;
}

/**
 * Besucher-/Akteur-Auflösung (geteilt von View-Beacon, Feedback UND /ask).
 * Session wird NUR nachgeschlagen, wenn überhaupt ein better-auth-Session-
 * Cookie mitkommt (anonyme Mehrheit zahlt keinen Auth-Roundtrip). Fehler beim
 * Lookup ⇒ anonym (für Analytics unkritisch, es hängt kein Privileg daran).
 *
 * ABUSE-SEITE: Die ID ist nicht mehr mitgeschickt, sondern ABGELEITET — es
 * gibt also nichts mehr zu fälschen oder zu rotieren. Wer seine Zählung
 * zurücksetzen will, muss die Adresse wechseln; wer fremde MAU aufblähen
 * will, braucht viele Adressen UND muss am Rate-Limit der Event-Endpunkte
 * vorbei. Das frühere Cookie ließ sich dagegen bei jedem Request neu
 * erfinden (deshalb war es signiert).
 */
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
        };
      }
    } catch {
      /* anonym weiterzählen */
    }
  }

  // Anonym: ID ableiten. Ohne Codec (dev ohne Secret) eine Zufalls-ID — dort
  // gibt es kein Billing, und eine feste Kennung wäre irreführender als eine
  // sichtbar wegwerfbare.
  const tenantId = c.get("tenant").id;
  if (!codec) {
    return { actorType: "anon", visitorId: crypto.randomUUID(), userId: null };
  }
  const visitorId = await codec.derive({
    tenantId,
    period: periodOf(Date.now()),
    // Nur was der Browser ohnehin schickt — nichts wird per `Accept-CH`
    // nachgefordert (das wäre Fingerprinting, s. security/visitor-id.ts).
    signals: {
      ip: clientIp(c),
      userAgent: c.req.header("user-agent") ?? "",
      acceptLanguage: c.req.header("accept-language") ?? "",
      platform: c.req.header("sec-ch-ua-platform") ?? "",
      mobile: c.req.header("sec-ch-ua-mobile") ?? "",
    },
  });
  return { actorType: "anon", visitorId, userId: null };
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
