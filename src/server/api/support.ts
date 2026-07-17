import { Hono } from "hono";
import { requireTeam } from "@/server/auth/guards";
import type { TicketStatus } from "@/server/support/store";
import type { ApiDeps, ApiEnv } from "./context";
import { applyVisitorCookie, resolveActor } from "./events";
import { allowRequest, clientIp, rateLimited } from "./rate-limit";

/**
 * SUPPORT-FLOW (Architektur 2026-06-28, Richtung A: Endnutzer → Tenant).
 *
 *   POST   /api/v1/support/tickets      — PUBLIC: „Etwas stimmt nicht?"
 *   GET    /api/v1/admin/support        — requireTeam(admin): Inbox-Liste
 *   PATCH  /api/v1/admin/support/:id    — Status open|done
 *   DELETE /api/v1/admin/support/:id    — Ticket löschen
 *
 * Die TRIAGE liegt im UX-Fluss davor: Der Button erscheint bei KI-Antworten
 * (inkl. No-Answer) — Inhaltsfragen hat die KI dann bereits beantwortet bzw.
 * ehrlich verneint; was hier ankommt, ist der echte Support-/Technikfall.
 *
 * PUBLIC-Missbrauchsschutz in Schichten: IP-Rate-Limit (5/min, sensitive),
 * strikte Längen, signierte Besucher-Zuordnung; Mail ist Best-Effort an die
 * KONFIGURIERTE Tenant-Adresse (nie an Nutzer-Input) — die Inbox verliert nie.
 */

const MESSAGE_MIN = 10;
const MESSAGE_MAX = 2000;
const QUESTION_MAX = 400;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INBOX_LIMIT = 200;

export function supportPublicRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  r.post("/tickets", async (c) => {
    if (
      !(await allowRequest(deps.rateLimiters?.sensitive, `ticket:${c.get("tenant").id}:${clientIp(c)}`))
    ) {
      return rateLimited(c);
    }

    let body: { message?: unknown; contactEmail?: unknown; question?: unknown };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    if (typeof body.message !== "string") return c.json({ error: "invalid_message" }, 400);
    const message = body.message.trim();
    if (message.length < MESSAGE_MIN || message.length > MESSAGE_MAX) {
      return c.json({ error: "invalid_message" }, 400);
    }

    let contactEmail: string | null = null;
    if (body.contactEmail !== undefined && body.contactEmail !== null && body.contactEmail !== "") {
      if (
        typeof body.contactEmail !== "string" ||
        body.contactEmail.trim().length > 254 ||
        !EMAIL_RE.test(body.contactEmail.trim())
      ) {
        return c.json({ error: "invalid_contact_email" }, 400);
      }
      contactEmail = body.contactEmail.trim().toLowerCase();
    }

    const question =
      typeof body.question === "string" && body.question.trim().length > 0
        ? body.question.trim().slice(0, QUESTION_MAX)
        : null;

    const support = await deps.getSupportDeps?.();
    if (!support) return c.json({ error: "support_unavailable" }, 503);

    const actor = await resolveActor(c, deps.visitorCodec);
    applyVisitorCookie(c, actor);

    const tenant = c.get("tenant");
    await support.repo.create({
      tenantId: tenant.id,
      message,
      contactEmail,
      question,
      actorType: actor.actorType,
      visitorId: actor.visitorId,
      nowSec: Math.floor(Date.now() / 1000),
    });

    // Mail an die KONFIGURIERTE Support-Adresse — Best-Effort: ein Mail-
    // Fehler nimmt das Ticket nicht zurück (Inbox ist die Wahrheit).
    if (tenant.supportEmail) {
      try {
        await support.sendTicketMail({
          to: tenant.supportEmail,
          tenantName: tenant.name,
          message,
          contactEmail,
          question,
        });
      } catch (err) {
        console.error("[support] Ticket-Mail fehlgeschlagen (Ticket gespeichert):", err);
      }
    }

    return c.json({ ok: true }, 201);
  });

  return r;
}

export function supportAdminRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  r.get("/", requireTeam("admin"), async (c) => {
    const support = await deps.getSupportDeps?.();
    if (!support) return c.json({ error: "support_unavailable" }, 503);
    const tickets = await support.repo.listByTenant(c.get("tenant").id, INBOX_LIMIT);
    return c.json({ tickets });
  });

  r.patch("/:id", requireTeam("admin"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "not_found" }, 404);

    let status: unknown;
    try {
      status = ((await c.req.json()) as { status?: unknown }).status;
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    if (status !== "open" && status !== "done") return c.json({ error: "invalid_status" }, 400);

    const support = await deps.getSupportDeps?.();
    if (!support) return c.json({ error: "support_unavailable" }, 503);

    const changed = await support.repo.setStatus(c.get("tenant").id, id, status as TicketStatus);
    if (!changed) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true, status });
  });

  r.delete("/:id", requireTeam("admin"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "not_found" }, 404);
    const support = await deps.getSupportDeps?.();
    if (!support) return c.json({ error: "support_unavailable" }, 503);
    const removed = await support.repo.remove(c.get("tenant").id, id);
    if (!removed) return c.json({ error: "not_found" }, 404);
    return c.json({ ok: true });
  });

  return r;
}
