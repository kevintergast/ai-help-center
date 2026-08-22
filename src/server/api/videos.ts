import type { Context } from "hono";
import { Hono } from "hono";
import { requireTeam } from "@/server/auth/guards";
import type { GuardSessionData } from "./context";
import { parseYouTubeId } from "@/server/content/validate";
import {
  fetchVideoTitle,
  MAX_TRANSCRIPT_CHARS,
  normalizePastedTranscript,
  tryFetchTranscript,
} from "@/server/content/video-meta";
import type { ApiDeps, ApiEnv } from "./context";

/**
 * VIDEO-AUFBEREITUNG (Editor-Hilfe): `POST /api/v1/admin/videos/prepare`
 * macht aus einem YouTube-Link einen brauchbaren Titel + eine
 * Beschreibung, die als KI-Kontext taugt (die Frage-Pipeline matcht gegen
 * die Video-Beschreibung — s. video-summary.ts).
 *
 * ZWEI STUFEN, bewusst getrennt:
 *  1. TITEL: immer, über den offiziellen oEmbed-Endpunkt — KOSTENLOS.
 *  2. BESCHREIBUNG: nur MIT Transkript. Wir versuchen es automatisch
 *     (scheitert aus Worker-IPs erwartbar, s. video-meta.ts) und antworten
 *     sonst mit `needsTranscript: true`; das Team fügt es dann aus dem
 *     YouTube-Transkript-Panel ein. Die KI-Aufbereitung kostet Credits —
 *     verbucht NUR bei Erfolg (ai_video_summary, 0026).
 *
 * KEINE HALLUZINATION: Ohne Transkript wird KEINE Beschreibung generiert
 * (eine erfundene würde in den Such-Index wandern).
 * Gating: requireTeam("content") + Freeze-Gate (app.ts) + Rate-Limit.
 */

async function actorId(c: Context<ApiEnv>): Promise<string | null> {
  try {
    const auth = await c.get("getAuth")();
    const data = (await auth.api.getSession({
      headers: c.req.raw.headers,
    })) as (GuardSessionData & { user?: { id?: string } }) | null;
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

export function videosAdminRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  r.post("/prepare", requireTeam("content"), async (c) => {
    let body: { youtubeUrl?: unknown; transcript?: unknown };
    try {
      body = (await c.req.json()) as typeof body;
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    const source = typeof body.youtubeUrl === "string" ? body.youtubeUrl : "";
    const youtubeId = parseYouTubeId(source);
    if (!youtubeId) return c.json({ error: "youtube_url_invalid" }, 400);

    if (typeof body.transcript === "string" && body.transcript.length > MAX_TRANSCRIPT_CHARS * 2) {
      return c.json({ error: "transcript_too_large" }, 413);
    }

    const tenant = c.get("tenant");
    // Titel zuerst (kostenlos) — er ist auch ohne Transkript nützlich.
    const videoTitle = await fetchVideoTitle(youtubeId);

    // Transkript: eingefügtes gewinnt, sonst Best-Effort-Abruf.
    const pasted =
      typeof body.transcript === "string" ? normalizePastedTranscript(body.transcript) : "";
    const transcript = pasted.length > 0 ? pasted : await tryFetchTranscript(youtubeId);

    if (!transcript || transcript.length < 40) {
      // Ehrlich: ohne Inhalt keine Beschreibung, keine Credits.
      return c.json({
        ok: true,
        youtubeId,
        title: videoTitle,
        description: null,
        needsTranscript: true,
      });
    }

    const summarize = await deps.getVideoSummarizer?.();
    if (!summarize) return c.json({ error: "summarizer_unavailable" }, 503);

    let result;
    try {
      result = await summarize({ transcript, videoTitle, locale: tenant.defaultLocale });
    } catch (err) {
      // Modell-/Formatfehler: NICHTS verbucht (Fehlschläge kosten nichts).
      console.error("[video-prepare] Aufbereitung fehlgeschlagen:", err);
      return c.json({ error: "summary_failed" }, 502);
    }

    const billing = await deps.getBillingDeps?.();
    if (billing) {
      const userId = await actorId(c);
      await billing.repo.recordAiVideoSummary({
        tenantId: tenant.id,
        actorType: "internal",
        visitorId: userId ? `u:${userId}` : "u:unknown",
        userId,
        nowSec: Math.floor(Date.now() / 1000),
      });
    }

    return c.json({
      ok: true,
      youtubeId,
      // Der KI-Titel benennt den INHALT; der YouTube-Titel bleibt als
      // Alternative dabei (das UI zeigt beide zur Wahl).
      title: result.title,
      youtubeTitle: videoTitle,
      description: result.description,
      needsTranscript: false,
      transcriptSource: pasted.length > 0 ? ("pasted" as const) : ("fetched" as const),
    });
  });

  return r;
}
