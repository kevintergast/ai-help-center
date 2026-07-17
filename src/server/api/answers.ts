import { Hono, type Context } from "hono";
import type { SourceRef } from "@/lib/content/types";
import { enforceSessionTenant } from "@/server/auth/session-guard";
import {
  parseSavedAnswerInput,
  MAX_SAVED_ANSWERS_PER_USER,
} from "@/server/answers/store";
import type { AnswerRefs } from "@/server/answers/staleness";
import type { ApiDeps, ApiEnv, GuardSessionData } from "./context";
import { allowRequest, clientIp, rateLimited } from "./rate-limit";

/**
 * GESPEICHERTE KI-ANTWORTEN (Architektur: local-first + Account-Sync +
 * Staleness).
 *
 *  - POST /answers/check   — PUBLIC: Staleness-Prüfung für LOKAL gespeicherte
 *    Antworten (anonyme Nutzer sind der Normalfall). Reiner Hash-Vergleich
 *    gegen VERÖFFENTLICHTE Inhalte — kein Draft-Orakel: für Entwürfe/gelöschte
 *    Quellen ist die Antwort schlicht „veraltet", ohne Grund-Detail.
 *  - GET/PUT/DELETE /answers[...] — KONTO-Sync (Session Pflicht, default-deny
 *    greift automatisch): jede Zeile strikt (tenant, user)-gebunden.
 */

const MAX_CHECK_ANSWERS = 50;
const MAX_REFS_PER_ANSWER = 24;

/** Angemeldeten Nutzer DIESER Instanz lesen (beliebige Rolle; sonst null). */
async function readSessionUser(c: Context<ApiEnv>): Promise<{ id: string } | null> {
  try {
    const auth = await c.get("getAuth")();
    const data = (await auth.api.getSession({
      headers: c.req.raw.headers,
    })) as (GuardSessionData & { user: { id?: string } }) | null;
    if (!data?.user?.id || !enforceSessionTenant(data.session)) return null;
    return { id: data.user.id };
  } catch {
    return null;
  }
}

/** Body der Check-Route → validierte AnswerRefs (oder null = 400). */
function parseCheckBody(raw: unknown): AnswerRefs[] | null {
  if (typeof raw !== "object" || raw === null) return null;
  const list = (raw as { answers?: unknown }).answers;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_CHECK_ANSWERS) return null;

  const out: AnswerRefs[] = [];
  for (const item of list) {
    const o = item as Record<string, unknown>;
    if (typeof o?.id !== "string" || o.id.length === 0 || o.id.length > 40) return null;
    if (!Array.isArray(o.refs) || o.refs.length > MAX_REFS_PER_ANSWER) return null;
    const refs: SourceRef[] = [];
    for (const r of o.refs) {
      const rr = r as Record<string, unknown>;
      if (
        typeof rr?.articleId !== "string" ||
        rr.articleId.length === 0 ||
        rr.articleId.length > 80 ||
        typeof rr?.chunkIndex !== "number" ||
        !Number.isInteger(rr.chunkIndex) ||
        rr.chunkIndex < 0 ||
        typeof rr?.contentHash !== "string" ||
        rr.contentHash.length > 64
      ) {
        return null;
      }
      refs.push({ articleId: rr.articleId, chunkIndex: rr.chunkIndex, contentHash: rr.contentHash });
    }
    out.push({ id: o.id, refs });
  }
  return out;
}

export function answersRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  // ── PUBLIC: Staleness-Check (steht in PUBLIC_ROUTES + Snapshot) ──────────
  r.post("/check", async (c) => {
    if (!(await allowRequest(deps.rateLimiters?.events, `ev:${c.get("tenant").id}:${clientIp(c)}`))) {
      return rateLimited(c);
    }
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const answers = parseCheckBody(body);
    if (!answers) return c.json({ error: "invalid_body" }, 400);

    const answersDeps = await deps.getAnswersDeps?.();
    if (!answersDeps) return c.json({ error: "answers_unavailable" }, 503);

    const stale = await answersDeps.findStale(c.get("tenant").id, answers);
    return c.json({ stale });
  });

  // ── KONTO-SYNC (Session Pflicht — default-deny hat anonyme schon 401t;
  //    hier zusätzlich fail-closed, falls die Route je umgehängt wird) ──────
  r.get("/", async (c) => {
    const user = await readSessionUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const answersDeps = await deps.getAnswersDeps?.();
    if (!answersDeps) return c.json({ error: "answers_unavailable" }, 503);

    const answers = await answersDeps.repo.listByUser(c.get("tenant").id, user.id);
    return c.json({ answers, limit: MAX_SAVED_ANSWERS_PER_USER });
  });

  r.put("/:id", async (c) => {
    const user = await readSessionUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const answersDeps = await deps.getAnswersDeps?.();
    if (!answersDeps) return c.json({ error: "answers_unavailable" }, 503);

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const parsed = parseSavedAnswerInput(body);
    if (typeof parsed === "string") return c.json({ error: parsed }, 400);
    if (parsed.id !== c.req.param("id")) return c.json({ error: "id_mismatch" }, 400);

    const result = await answersDeps.repo.upsert(c.get("tenant").id, user.id, parsed);
    if (result === "limit_reached") {
      return c.json({ error: "saved_answers_limit_reached" }, 409);
    }
    // stale_write ist KEIN Fehler: der Client holt beim nächsten GET den
    // neueren Konto-Stand — 200 mit Hinweis reicht.
    return c.json({ ok: true, result });
  });

  r.delete("/:id", async (c) => {
    const user = await readSessionUser(c);
    if (!user) return c.json({ error: "unauthorized" }, 401);
    const answersDeps = await deps.getAnswersDeps?.();
    if (!answersDeps) return c.json({ error: "answers_unavailable" }, 503);

    await answersDeps.repo.remove(c.get("tenant").id, user.id, c.req.param("id"));
    return c.json({ ok: true });
  });

  return r;
}
