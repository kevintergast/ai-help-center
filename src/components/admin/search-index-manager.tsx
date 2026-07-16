"use client";

import { useState } from "react";
import { getT } from "@/i18n/t";
import type { Locale } from "@/lib/tenant/types";
import { Button } from "@/components/ui/button";
import { ErrorNote } from "@/components/auth/notes";

/**
 * SUCH-INDEX-VERWALTUNG (Einstellungen): stößt den kompletten Neuaufbau des
 * KI-/Such-Index an (POST /admin/articles/reindex, owner-exklusiv). Im
 * Normalbetrieb hält der Veröffentlichungs-Lifecycle den Index automatisch
 * aktuell — der Button ist für den Erst-Backfill (z. B. direkt nach dem
 * Launch) und als Reparatur-Hebel. Unveränderte Artikel kosten dank
 * Hash-Vergleich nichts.
 */
export function SearchIndexManager({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<{ articles: number; embedded: number } | null>(null);

  async function rebuild() {
    setBusy(true);
    setError("");
    setResult(null);
    try {
      const res = await fetch("/api/v1/admin/articles/reindex", { method: "POST" });
      if (res.ok) {
        const data = (await res.json()) as { articles: number; embedded: number };
        setResult({ articles: data.articles, embedded: data.embedded });
        return;
      }
      setError(res.status === 403 ? t("admin.searchIndex.ownerOnly") : t("admin.searchIndex.error"));
    } catch {
      setError(t("admin.searchIndex.error"));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex max-w-xl flex-col gap-3">
      <p className="-mt-1 text-xs text-ink-muted">{t("admin.searchIndex.intro")}</p>
      {result ? (
        <p className="text-sm text-ok">
          {t("admin.searchIndex.done", { articles: result.articles, embedded: result.embedded })}
        </p>
      ) : null}
      <ErrorNote>{error || null}</ErrorNote>
      <div>
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void rebuild()}>
          {busy ? t("admin.searchIndex.running") : t("admin.searchIndex.rebuild")}
        </Button>
      </div>
    </div>
  );
}
