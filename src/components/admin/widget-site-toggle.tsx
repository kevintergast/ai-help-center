"use client";

import { useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { Switch } from "@/components/ui/switch";

/**
 * Schalter „Widget auch im eigenen Hilfezentrum" (Settings, Migration 0027):
 * bindet auf den öffentlichen Seiten dieser Instanz genau das Kunden-Snippet
 * ein — ein zweiter Einstieg neben Suche und „Frage stellen", und für uns die
 * Demo-Fläche, auf der Interessenten das Widget live ausprobieren.
 *
 * Persistiert über PUT /api/v1/admin/settings/widget-on-site (admin-Gate; bei
 * 403 springt der Schalter zurück und erklärt warum).
 */
export function WidgetSiteToggle({
  locale,
  initialOn,
}: {
  locale: Locale;
  initialOn: boolean;
}) {
  const t = getT(locale);
  const [on, setOn] = useState(initialOn);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "admin_only" | "error">("idle");

  async function toggle(next: boolean) {
    setOn(next); // optimistisch; bei Fehler unten zurückdrehen
    setState("saving");
    try {
      const res = await fetch("/api/v1/admin/settings/widget-on-site", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ on: next }),
      });
      if (res.ok) {
        setState("saved");
        return;
      }
      setOn(!next);
      setState(res.status === 403 ? "admin_only" : "error");
    } catch {
      setOn(!next);
      setState("error");
    }
  }

  return (
    <div className="flex flex-col gap-2 border-t border-hairline pt-5">
      <Switch
        checked={on}
        onCheckedChange={(next) => void toggle(next)}
        label={t("admin.settings.widget.site.label")}
      />
      <p className="text-xs text-ink-muted">{t("admin.settings.widget.site.hint")}</p>
      <p aria-live="polite" className="min-h-4 text-xs">
        {state === "saving" ? (
          <span className="text-ink-muted">{t("admin.settings.widget.site.saving")}</span>
        ) : state === "saved" ? (
          <span className="text-ok">
            {on
              ? t("admin.settings.widget.site.savedOn")
              : t("admin.settings.widget.site.savedOff")}
          </span>
        ) : state === "admin_only" ? (
          <span className="text-warn">{t("admin.settings.widget.site.adminOnly")}</span>
        ) : state === "error" ? (
          <span className="text-crit">{t("admin.settings.widget.site.error")}</span>
        ) : null}
      </p>
    </div>
  );
}
