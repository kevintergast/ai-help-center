"use client";

import { useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { Switch } from "@/components/ui/switch";

/**
 * KI-CRAWLER-SCHALTER (Settings, Migration 0051).
 *
 * Bis hierher waren GPTBot & Co. implizit erlaubt, weil robots.txt `*`
 * freigibt. Dieser Schalter ändert daran nichts — er macht die Entscheidung
 * nur sichtbar und umkehrbar. AUS ⇒ je KI-Agent ein eigener Disallow-Block.
 *
 * BEWUSST neben, nicht unter dem SEO-Schalter: „bei Google auffindbar" und
 * „in Chatbots zitierbar" sind zwei Fragen. Wer intern dokumentiert, sagt bei
 * beiden nein; wer Reichweite will, bei beiden ja; und dazwischen gibt es
 * echte Fälle für genau eins von beidem.
 *
 * Persistiert über PUT /api/v1/admin/settings/ai-crawlers — OWNER-only
 * (403 für admin/content wird als Hinweis angezeigt, der Switch springt
 * zurück).
 */
export function AiCrawlersManager({
  locale,
  initialAllowed,
}: {
  locale: Locale;
  initialAllowed: boolean;
}) {
  const t = getT(locale);
  const [allowed, setAllowed] = useState(initialAllowed);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "owner_only" | "error">("idle");

  async function toggle(next: boolean) {
    setAllowed(next); // optimistisch; bei Fehler unten zurückdrehen
    setState("saving");
    try {
      const res = await fetch("/api/v1/admin/settings/ai-crawlers", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ allowed: next }),
      });
      if (res.ok) {
        setState("saved");
        return;
      }
      setAllowed(!next);
      setState(res.status === 403 ? "owner_only" : "error");
    } catch {
      setAllowed(!next);
      setState("error");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Switch
        checked={allowed}
        onCheckedChange={(next) => void toggle(next)}
        label={t("admin.settings.aiCrawlers.label")}
      />
      <p className="text-xs text-ink-muted">{t("admin.settings.aiCrawlers.hint")}</p>
      <p aria-live="polite" className="min-h-4 text-xs">
        {state === "saving" ? (
          <span className="text-ink-muted">{t("admin.settings.seo.saving")}</span>
        ) : state === "saved" ? (
          <span className="text-ok">
            {allowed
              ? t("admin.settings.aiCrawlers.savedOn")
              : t("admin.settings.aiCrawlers.savedOff")}
          </span>
        ) : state === "owner_only" ? (
          <span className="text-warn">{t("admin.settings.seo.ownerOnly")}</span>
        ) : state === "error" ? (
          <span className="text-crit">{t("admin.settings.seo.error")}</span>
        ) : null}
      </p>
    </div>
  );
}
