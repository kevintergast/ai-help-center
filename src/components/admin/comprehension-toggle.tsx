"use client";

import { useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { Switch } from "@/components/ui/switch";

/**
 * Schalter für „Ich verstehe etwas nicht" (0040). Standard AN — eine Instanz,
 * die keine Rückmeldungen will, schaltet ab, aber der Normalfall ist, sie zu
 * wollen.
 *
 * Aus heißt WIRKLICH aus: Der Knopf verschwindet, und der öffentliche
 * Endpunkt antwortet mit 404 — nicht nur die Oberfläche versteckt ihn.
 */
export function ComprehensionToggle({
  locale,
  initialOn,
}: {
  locale: Locale;
  initialOn: boolean;
}) {
  const t = getT(locale);
  const [on, setOn] = useState(initialOn);
  const [state, setState] = useState<"idle" | "saving" | "error">("idle");

  async function toggle(next: boolean) {
    setOn(next);
    setState("saving");
    try {
      const res = await fetch("/api/v1/admin/settings/comprehension-mode", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ on: next }),
      });
      if (!res.ok) throw new Error("save");
      setState("idle");
    } catch {
      // Zurückdrehen: Der Schalter darf keinen Zustand zeigen, den der Server
      // nicht hat.
      setOn(!next);
      setState("error");
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Switch
        checked={on}
        onCheckedChange={(v) => void toggle(v)}
        label={t("admin.settings.comprehension")}
      />
      <p className="text-xs text-ink-muted">{t("admin.settings.comprehensionHint")}</p>
      {state === "error" ? (
        <p className="text-xs text-crit" role="alert">
          {t("admin.contact.error.generic")}
        </p>
      ) : null}
    </div>
  );
}
