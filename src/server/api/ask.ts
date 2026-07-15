import { Hono } from "hono";
import type { AskOutcome } from "@/server/rag/ask";
import type { ApiDeps, ApiEnv } from "./context";
import { applyVisitorCookie, resolveActor } from "./events";

/**
 * DYNAMISCHER KI-ARTIKEL — öffentliche Frage-API (RAG-Kern, „Punkt 3").
 *
 *   POST /api/v1/ask { question } → AskAnswer-JSON
 *
 * PUBLIC (Allowlist + Snapshot): das Hilfezentrum ist öffentlich, anonyme
 * Besucher sind der Normalfall. Schutz gegen Missbrauch liegt in Schichten
 * DAVOR bzw. DAHINTER: AI-Gateway (Spend-Limit/Rate-Limit/Caching), WAF-
 * Rate-Limit (User-Schritt), Grounding-Schwelle (keine Generierung ohne
 * Treffer) und Plan-Gate (frozen → 402, VOR jedem AI-Aufruf).
 * Besucher-Identität wie beim View-Beacon (hoh_vid-Cookie) → MAU/Credits.
 */

const MIN_QUESTION_CHARS = 3;
const MAX_QUESTION_CHARS = 400;

export function askPublicRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  r.post("/", async (c) => {
    let question: unknown;
    try {
      question = ((await c.req.json()) as { question?: unknown }).question;
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    if (typeof question !== "string") return c.json({ error: "invalid_question" }, 400);
    const trimmed = question.trim().replace(/\s+/g, " ");
    if (trimmed.length < MIN_QUESTION_CHARS || trimmed.length > MAX_QUESTION_CHARS) {
      return c.json({ error: "invalid_question" }, 400);
    }

    const ask = await deps.getAskDeps?.();
    if (!ask) return c.json({ error: "ask_unavailable" }, 503);

    const actor = await resolveActor(c);
    applyVisitorCookie(c, actor);

    let outcome: AskOutcome;
    try {
      outcome = await ask.answer({
        tenantId: c.get("tenant").id,
        question: trimmed,
        actor: { actorType: actor.actorType, visitorId: actor.visitorId, userId: actor.userId },
        nowSec: Math.floor(Date.now() / 1000),
      });
    } catch (err) {
      // Modell-/Retrieval-Fehler: laut loggen, dem Client eine neutrale,
      // wiederholbare Fehlermeldung geben (es wurde NICHTS verbucht).
      console.error("[ask] Pipeline fehlgeschlagen:", err);
      return c.json({ error: "ask_failed" }, 502);
    }

    if (outcome.status === "frozen") return c.json({ error: "plan_frozen" }, 402);
    return c.json(outcome.answer);
  });

  return r;
}
