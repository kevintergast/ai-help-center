"use client";

import { useState, type FormEvent } from "react";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

/**
 * Link auf die EIGENE API-Dokumentation (Migration 0033) — erscheint oben in
 * der Navigation des Hilfezentrums, direkt bei Roadmap und Changelog.
 *
 * WARUM NUR EIN LINK: API-Referenzen werden aus einem Spec generiert und
 * ändern sich mit jedem Release. Eine gerenderte Kopie bei uns wäre nach dem
 * ersten Deploy des Kunden falsch. Der Kunde behält seine Doku, wo sie ist.
 *
 * NUR https (serverseitig erzwungen, api/settings.ts): Der Link steht in der
 * Navigation JEDES Besuchers — kein Platz für `javascript:` oder
 * Mixed-Content. Leeres Feld entfernt den Link.
 */
export function ApiDocsManager({
  locale,
  initialUrl,
}: {
  locale: Locale;
  initialUrl: string | null;
}) {
  const t = getT(locale);
  const [url, setUrl] = useState(initialUrl ?? "");
  const [state, setState] = useState<"idle" | "saving" | "saved" | "invalid" | "error">("idle");

  async function save(e: FormEvent) {
    e.preventDefault();
    setState("saving");
    try {
      const res = await fetch("/api/v1/admin/settings/api-docs", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ url: url.trim() === "" ? null : url.trim() }),
      });
      if (res.ok) {
        const data = (await res.json()) as { url: string | null };
        setUrl(data.url ?? "");
        setState("saved");
        return;
      }
      setState(res.status === 400 ? "invalid" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <form onSubmit={save} className="flex flex-col gap-3" noValidate>
      <Input
        label={t("admin.settings.apiDocs")}
        type="url"
        value={url}
        onChange={(e) => {
          setUrl(e.target.value);
          setState("idle");
        }}
        placeholder={t("admin.settings.apiDocsPlaceholder")}
        className="max-w-md"
      />
      <p className="-mt-1 text-xs text-ink-muted">{t("admin.settings.apiDocsHint")}</p>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={state === "saving"}>
          {state === "saving" ? t("admin.settings.apiDocsSaving") : t("admin.settings.apiDocsSave")}
        </Button>
        <span aria-live="polite" className="text-xs">
          {state === "saved" ? (
            <span className="text-ok">
              {url ? t("admin.settings.apiDocsSaved") : t("admin.settings.apiDocsCleared")}
            </span>
          ) : state === "invalid" ? (
            <span className="text-crit">{t("admin.settings.apiDocsInvalid")}</span>
          ) : state === "error" ? (
            <span className="text-crit">{t("admin.settings.seo.error")}</span>
          ) : null}
        </span>
      </div>
    </form>
  );
}
