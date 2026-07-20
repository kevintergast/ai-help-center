"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ArticleTranslationInfo } from "@/lib/content/types";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { CREDIT_COSTS } from "@/server/billing/pricing";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

/**
 * ÜBERSETZUNGEN-Sektion im Artikel-Editor (Translation-Sets). Zeigt die
 * Sprachfassungen des Sets und legt fehlende an — manuell (Kopie als
 * Startpunkt) oder per KI (bezahlt, Credits-Preis steht am Button; verbucht
 * wird serverseitig NACH Erfolg). Neue Fassungen starten als Entwurf.
 *
 * DIRTY-GATE (Datenverlust-Schutz): Anlegen UND Wechseln navigieren zum
 * Ziel-Artikel — mit ungespeicherten Änderungen wäre der Entwurf weg.
 * Deshalb sind beide Aktionen erst nach dem Veröffentlichen möglich.
 * Die Mitglieder kommen als SERVER-Prop (kein Client-Fetch, SSR-fest).
 */

const ALL_LOCALES: Locale[] = ["de", "en"];

export function ArticleTranslations({
  locale,
  articleId,
  members,
  dirty = false,
}: {
  locale: Locale;
  articleId: string;
  members: ArticleTranslationInfo[];
  dirty?: boolean;
}) {
  const t = getT(locale);
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function createTranslation(target: Locale, mode: "manual" | "ai") {
    setBusy(`${target}:${mode}`);
    setError(null);
    try {
      const res = await fetch(`/api/v1/admin/articles/${articleId}/translations`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: target, mode }),
      });
      const data = (await res.json().catch(() => null)) as { id?: string; error?: string } | null;
      if (!res.ok || !data?.id) {
        setError(
          data?.error === "translation_failed"
            ? t("editor.translations.errAi")
            : data?.error === "plan_frozen"
              ? t("editor.translations.errFrozen")
              : t("editor.translations.errGeneric"),
        );
        return;
      }
      router.push(`/admin/articles/${data.id}`);
    } catch {
      setError(t("editor.translations.errGeneric"));
    } finally {
      setBusy(null);
    }
  }

  const missing = ALL_LOCALES.filter((l) => !members.some((m) => m.locale === l));

  return (
    <div>
      <span className="mb-1 block text-sm text-ink-muted">{t("editor.translations.title")}</span>
      <p className="mb-3 text-xs text-ink-muted">{t("editor.translations.hint")}</p>

      {members.length > 0 ? (
        <ul className="mb-3 flex flex-col gap-2">
          {members.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-3 rounded-comfy border border-hairline bg-surface px-4 py-2.5"
            >
              <span className="text-xs font-semibold uppercase text-ink">{m.locale}</span>
              <Badge tone={m.lifecycle === "published" ? "ok" : "neutral"} dot>
                {m.lifecycle === "published" ? t("hc.status.current") : t("hc.status.draft")}
              </Badge>
              <span className="flex-1 truncate text-sm text-ink-muted">/{m.slug}</span>
              {m.id === articleId ? (
                <span className="text-xs text-ink-muted">{t("editor.translations.current")}</span>
              ) : dirty ? (
                <span
                  title={t("editor.translations.dirtyHint")}
                  className="cursor-not-allowed text-sm text-ink-muted/60"
                >
                  {t("editor.translations.open")}
                </span>
              ) : (
                <Link
                  href={`/admin/articles/${m.id}`}
                  className="text-sm text-brand hover:underline"
                >
                  {t("editor.translations.open")}
                </Link>
              )}
            </li>
          ))}
        </ul>
      ) : null}

      {missing.map((target) => (
        <div key={target} className="flex flex-wrap items-center gap-2">
          <span className="text-sm text-ink-muted">
            {t("editor.translations.missing", { locale: target.toUpperCase() })}
          </span>
          <Button
            variant="cream"
            size="sm"
            disabled={busy !== null || dirty}
            onClick={() => void createTranslation(target, "ai")}
          >
            {busy === `${target}:ai`
              ? t("editor.translations.translating")
              : t("editor.translations.aiButton", { credits: CREDIT_COSTS.ai_translation })}
          </Button>
          <Button
            variant="ghost"
            size="sm"
            disabled={busy !== null || dirty}
            onClick={() => void createTranslation(target, "manual")}
          >
            {t("editor.translations.manualButton")}
          </Button>
        </div>
      ))}
      {dirty ? <p className="mt-2 text-xs text-warn">{t("editor.translations.dirtyHint")}</p> : null}
      {error ? <p className="mt-2 text-xs text-crit">{error}</p> : null}
    </div>
  );
}
