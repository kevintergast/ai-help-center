"use client";

import { useEffect } from "react";

/**
 * VIEW-BEACON (Infra-Plan Schritt 3): meldet einen Artikel-Aufruf an
 * POST /api/v1/events/view (fire-and-forget, 204). Rendert nichts.
 *
 * Client-seitiger Erst-Filter: pro Browser-Session und Artikel nur EIN Beacon
 * (sessionStorage) — Reloads/Zurück-Navigation spammen nicht. Der Server
 * dedupliziert zusätzlich (30-Minuten-Fenster pro Besucher+Artikel), sodass
 * ein manipulierter Client Credits nicht künstlich aufblasen kann.
 *
 * Bewusst CLIENT-seitig (statt SSR-Zählung): Bots/Crawler führen selten JS aus
 * → sauberere Zahlen; die Artikelseite bleibt voll cachebar.
 */
/**
 * „War das hilfreich?"-Feedback melden (Artikel: slug; KI-Antwort: slug=null).
 * Gleiche fire-and-forget-Beacon-Semantik wie der ViewBeacon; der Server
 * dedupliziert (24h je Besucher+Ziel+Richtung) und verbucht 0 Credits.
 */
export function sendFeedback(slug: string | null, helpful: boolean): void {
  const payload = JSON.stringify({ ...(slug ? { slug } : {}), helpful });
  try {
    const ok = navigator.sendBeacon?.(
      "/api/v1/events/feedback",
      new Blob([payload], { type: "application/json" }),
    );
    if (ok) return;
  } catch {
    /* fällt auf fetch zurück */
  }
  void fetch("/api/v1/events/feedback", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: payload,
    keepalive: true,
  }).catch(() => {});
}

export function ViewBeacon({ slug }: { slug: string }) {
  useEffect(() => {
    const guardKey = `hoh:viewed:${slug}`;
    try {
      if (sessionStorage.getItem(guardKey)) return;
      sessionStorage.setItem(guardKey, "1");
    } catch {
      /* Storage gesperrt (Private Mode): trotzdem melden, Server dedupliziert */
    }

    const payload = JSON.stringify({ slug });
    try {
      // sendBeacon übersteht Navigation/Tab-Schließen; Blob trägt den JSON-Typ.
      const ok = navigator.sendBeacon?.(
        "/api/v1/events/view",
        new Blob([payload], { type: "application/json" }),
      );
      if (ok) return;
    } catch {
      /* fällt auf fetch zurück */
    }
    void fetch("/api/v1/events/view", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: payload,
      keepalive: true,
    }).catch(() => {});
  }, [slug]);

  return null;
}
