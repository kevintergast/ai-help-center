"use client";

import { useState, type ReactNode } from "react";
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
  unhelpfulSlot = null,
}: {
  slug: string;
  labels: { question: string; yes: string; no: string; thanks: string };
  /**
   * Erscheint NACH einem Daumen runter (0048, Platzierung 2). Kommt fertig
   * gerendert von der Serverseite herein — diese Hülle entscheidet nur, OB
   * gezeigt wird, nicht was.
   */
  unhelpfulSlot?: ReactNode;
}) {
  const [unhelpful, setUnhelpful] = useState(false);
  return (
    <>
      <FeedbackBar
        labels={labels}
        onVote={(v) => {
          setUnhelpful(v === "down");
          sendFeedback(slug, v === "up");
        }}
      />
      {unhelpful ? unhelpfulSlot : null}
    </>
  );
}
