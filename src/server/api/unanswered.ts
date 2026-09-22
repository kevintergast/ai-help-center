import { Hono } from "hono";
import { requireTeam } from "@/server/auth/guards";
import { MAX_QUESTION_CHARS } from "@/server/unanswered/store";
import type { ApiDeps, ApiEnv } from "./context";
import { allowRequest, clientIp, rateLimited } from "./rate-limit";

/**
 * UNBEANTWORTETE FRAGEN (0047).
 *
 *   POST /api/v1/unanswered/report   — „Ich brauche dazu eine Antwort" (public)
 *   GET  /api/v1/admin/unanswered    — Redaktions-Warteschlange (content)
 *
 * WARUM DER MELDE-WEG ÖFFENTLICH IST: Er ist die Fortsetzung der KI-Antwort
 * für genau den Menschen, der gerade keine bekommen hat — ein Login davor
 * würde das Signal genau bei denen abschneiden, die es am dringendsten
 * abgeben. Abgesichert wie die übrigen öffentlichen Schreibwege: IP-Limit
 * (events), harte Längen, keine Rückmeldung über Erfolg im Sinne eines
 * Orakels (es gibt nichts zu erraten).
 *
 * Der Wortlaut wird beim automatischen Mitschreiben ohnehin gespeichert
 * (rag/ask.ts); dieser Endpunkt hebt den Eintrag auf „jemand wartet darauf"
 * und nimmt freiwillig eine Adresse dazu.
 */

/** Pragmatische Plausibilität wie im Support-Flow — kein RFC-Parser. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Deckel der Verwaltungs-Liste. Mehr liest niemand durch. */
const LIST_LIMIT = 50;

export function unansweredPublicRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  r.post("/report", async (c) => {
    const tenantId = c.get("tenant").id;
    if (!(await allowRequest(deps.rateLimiters?.events, `ev:${tenantId}:${clientIp(c)}`))) {
      return rateLimited(c);
    }

    let body: { question?: unknown; email?: unknown };
    try {
      body = (await c.req.json()) as { question?: unknown; email?: unknown };
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    const question = typeof body.question === "string" ? body.question.trim() : "";
    if (question.length === 0 || question.length > MAX_QUESTION_CHARS) {
      return c.json({ error: "invalid_question" }, 400);
    }

    // Adresse ist FREIWILLIG. Unsinn wird abgelehnt statt still verworfen —
    // wer sie einträgt, erwartet eine Antwort und soll einen Tippfehler
    // merken, nicht ewig warten.
    let email: string | null = null;
    if (body.email !== undefined && body.email !== null && body.email !== "") {
      const raw = typeof body.email === "string" ? body.email.trim() : "";
      if (raw.length > 254 || !EMAIL_RE.test(raw)) return c.json({ error: "invalid_email" }, 400);
      email = raw.toLowerCase();
    }

    const repo = await deps.getUnansweredRepo?.();
    if (!repo) return c.json({ error: "unanswered_unavailable" }, 503);

    await repo.report({ tenantId, question, email, nowSec: Math.floor(Date.now() / 1000) });
    return c.json({ ok: true });
  });

  return r;
}

export function unansweredAdminRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  // `content`-Gate: Das ist Redaktions-Arbeitsvorrat, keine Instanz-Einstellung
  // — wer Artikel schreiben darf, soll sehen, was fehlt.
  r.get("/", requireTeam("content"), async (c) => {
    const repo = await deps.getUnansweredRepo?.();
    if (!repo) return c.json({ error: "unanswered_unavailable" }, 503);
    return c.json({ groups: await repo.list(c.get("tenant").id, LIST_LIMIT) });
  });

  return r;
}
