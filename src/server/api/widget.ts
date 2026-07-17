import { Hono } from "hono";
import type { ApiDeps, ApiEnv } from "./context";
import { applyVisitorCookie, VISITOR_HEADER } from "./events";
import { allowRequest, clientIp, rateLimited } from "./rate-limit";

/**
 * WIDGET-BOOTSTRAP (Bauphase Widget, 2026-07-17):
 *
 *   GET /api/v1/widget/session → { visitorId }
 *
 * Das eingebettete Widget (Cross-Site-iframe) kann das httpOnly-Besucher-
 * Cookie nicht lesen und Safari & Co. blocken Third-Party-Cookies ganz —
 * deshalb stellt dieser Endpoint die SIGNIERTE Besucher-ID einmal im Body
 * aus. Das Widget hält sie im (partitionierten) localStorage und sendet sie
 * fortan als `x-hoh-vid`-Header (resolveActor verifiziert die Signatur).
 * Zusätzlich wird das Cookie gesetzt (Browser, die es erlauben, dedupen
 * damit auch über Widget↔Hilfezentrum hinweg).
 *
 * PUBLIC (Allowlist + Snapshot): reine Identitätsvergabe, kein privilegierter
 * Effekt; Vergabe läuft über das events-Rate-Limit (Rotations-Bremse).
 */
export function widgetPublicRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  r.get("/session", async (c) => {
    const tenantId = c.get("tenant").id;
    if (!(await allowRequest(deps.rateLimiters?.events, `ev:${tenantId}:${clientIp(c)}`))) {
      return rateLimited(c);
    }

    // Bereits gültige ID (Header oder Cookie) wird WIEDERVERWENDET — sonst
    // würde jeder Widget-Load eine neue Identität prägen (MAU-Inflation).
    const codec = deps.visitorCodec;
    let visitorId: string | null = null;
    if (codec) {
      const fromHeader = c.req.header(VISITOR_HEADER);
      if (fromHeader) visitorId = await codec.verify(tenantId, fromHeader);
      if (!visitorId) {
        const cookieMatch = /(?:^|;\s*)hoh_vid=([^;]+)/.exec(c.req.header("cookie") ?? "");
        if (cookieMatch) visitorId = await codec.verify(tenantId, decodeURIComponent(cookieMatch[1]));
      }
      if (!visitorId) visitorId = await codec.issue(tenantId);
    } else {
      visitorId = crypto.randomUUID(); // dev ohne Secret (kein Billing)
    }

    applyVisitorCookie(c, {
      actorType: "anon",
      visitorId,
      userId: null,
      setVisitorCookie: visitorId,
    });
    return c.json({ visitorId });
  });

  return r;
}
