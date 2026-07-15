"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { getT } from "@/i18n/t";
import type { Locale } from "@/lib/tenant/types";
import { Button } from "@/components/ui/button";
import { PlusIcon } from "@/components/ui/icons";

/**
 * „Neuer Artikel": legt per API einen DRAFT mit Platzhalter-Titel und
 * zufälligem (später frei änderbarem) Slug an und springt direkt in den
 * Editor. Bei der (unwahrscheinlichen) Slug-Kollision wird einmal mit neuem
 * Suffix wiederholt; alles Weitere meldet der Fehlertext neben dem Button.
 */
export function NewArticleButton({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function createDraft(attempt = 0): Promise<void> {
    const suffix = Math.random().toString(36).slice(2, 8);
    const res = await fetch("/api/v1/admin/articles", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        title: t("editor.untitled"),
        slug: `artikel-${suffix}`,
        category: t("admin.articles.defaultCategory"),
      }),
    });
    if (res.status === 201) {
      const { id } = (await res.json()) as { id: string };
      router.push(`/admin/articles/${id}`);
      return;
    }
    if (res.status === 409 && attempt === 0) return createDraft(1);
    setError(true);
    setBusy(false);
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error ? <span className="text-xs text-crit">{t("admin.articles.createError")}</span> : null}
      <Button
        variant="primary"
        size="sm"
        disabled={busy}
        onClick={() => {
          setError(false);
          setBusy(true);
          void createDraft();
        }}
      >
        <PlusIcon width={16} height={16} />
        {busy ? t("admin.articles.creating") : t("admin.new")}
      </Button>
    </span>
  );
}
