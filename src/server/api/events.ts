import { Hono, type Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { UsageActorType } from "@/server/billing/store";
import type { ApiDeps, ApiEnv, GuardSessionData } from "./context";

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

interface ResolvedActor {
  actorType: UsageActorType;
  visitorId: string;
  userId: string | null;
  /** Cookie neu gesetzt? (nur für anonyme Erstbesucher) */
  setVisitorCookie: string | null;
}

/**
 * Besucher-/Akteur-Auflösung. Session wird NUR nachgeschlagen, wenn überhaupt
 * ein better-auth-Session-Cookie mitkommt (anonyme Mehrheit zahlt keinen
 * Auth-Roundtrip). Fehler beim Lookup ⇒ anonym (für Analytics unkritisch,
 * es hängt kein Privileg daran).
 */
async function resolveActor(c: Context<ApiEnv>): Promise<ResolvedActor> {
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

  const existing = getCookie(c, VISITOR_COOKIE);
  if (existing && /^[0-9a-f-]{36}$/.test(existing)) {
    return { actorType: "anon", visitorId: existing, userId: null, setVisitorCookie: null };
  }
  const fresh = crypto.randomUUID();
  return { actorType: "anon", visitorId: fresh, userId: null, setVisitorCookie: fresh };
}

export function eventsPublicRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  r.post("/view", async (c) => {
    const done = () => c.body(null, 204);

    let slug: unknown;
    try {
      slug = ((await c.req.json()) as { slug?: unknown }).slug;
    } catch {
      return done();
    }
    if (typeof slug !== "string" || slug.length === 0 || slug.length > 200) return done();

    const billing = await deps.getBillingDeps?.();
    if (!billing) return done();

    const actor = await resolveActor(c);
    if (actor.setVisitorCookie) {
      setCookie(c, VISITOR_COOKIE, actor.setVisitorCookie, {
        httpOnly: true,
        sameSite: "Lax",
        path: "/",
        maxAge: VISITOR_COOKIE_MAX_AGE_SEC,
        secure: new URL(c.req.url).protocol === "https:",
      });
    }

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

  return r;
}
