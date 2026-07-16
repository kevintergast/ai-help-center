"use client";

import { useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { Switch } from "@/components/ui/switch";

/**
 * SEO-Opt-out-Schalter (Settings, Migration 0013): steuert, ob dieses
 * Hilfezentrum von Suchmaschinen indexiert werden darf. AUS ⇒ noindex-Meta,
 * robots Disallow-all, leere Sitemap, raus aus dem zentralen Sitemap-Index.
 * Persistiert über PUT /api/v1/admin/settings/seo — OWNER-only (403 für
 * admin/content wird als Hinweis angezeigt, der Switch springt zurück).
 */
export function SeoIndexingManager({
  locale,
  initialIndexable,
}: {
  locale: Locale;
  initialIndexable: boolean;
}) {
  const t = getT(locale);
  const [indexable, setIndexable] = useState(initialIndexable);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "owner_only" | "error">("idle");

  async function toggle(next: boolean) {
    setIndexable(next); // optimistisch; bei Fehler unten zurückdrehen
    setState("saving");
    try {
      const res = await fetch("/api/v1/admin/settings/seo", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ indexable: next }),
      });
      if (res.ok) {
        setState("saved");
        return;
      }
      setIndexable(!next);
      setState(res.status === 403 ? "owner_only" : "error");
    } catch {
      setIndexable(!next);
      setState("error");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Switch
        checked={indexable}
        onCheckedChange={(next) => void toggle(next)}
        label={t("admin.settings.seo.label")}
      />
      <p className="text-xs text-ink-muted">{t("admin.settings.seo.hint")}</p>
      <p aria-live="polite" className="min-h-4 text-xs">
        {state === "saving" ? (
          <span className="text-ink-muted">{t("admin.settings.seo.saving")}</span>
        ) : state === "saved" ? (
          <span className="text-ok">
            {indexable ? t("admin.settings.seo.savedOn") : t("admin.settings.seo.savedOff")}
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
