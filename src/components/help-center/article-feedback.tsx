"use client";

import { FeedbackBar } from "@/components/ui/feedback-bar";
import { sendFeedback } from "./view-beacon";

/**
 * Client-Hülle der Artikel-FeedbackBar für die SSR-Artikelseite: verdrahtet
 * die Stimme mit dem Feedback-Beacon (POST /api/v1/events/feedback) — erst
 * seit es diese Meldung gibt, taucht Feedback in der Admin-Statistik auf.
 */
export function ArticleFeedback({
  slug,
  labels,
}: {
  slug: string;
  labels: { question: string; yes: string; no: string; thanks: string };
}) {
  return <FeedbackBar labels={labels} onVote={(v) => sendFeedback(slug, v === "up")} />;
}
