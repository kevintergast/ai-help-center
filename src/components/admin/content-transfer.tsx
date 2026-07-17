"use client";

import { useRef, useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { Button } from "@/components/ui/button";

/**
 * IMPORT/EXPORT-Leiste der Artikel-Verwaltung (Content-Werkzeuge).
 *
 *  - Export: direkter Download der JSON-Datei (GET, funktioniert auch im
 *    Freeze — Anti-Lock-in).
 *  - Import: .json (unsere Export-Datei, Bulk) oder .md (ein Artikel;
 *    optionales Front-Matter slug/category/locale, H1 = Titel). Der Server
 *    upsertet per Slug und liefert einen Bericht — der wird hier kompakt
 *    angezeigt; danach lädt die Seite neu (Server-Komponente zeigt frische
 *    Liste).
 */
export function ContentTransfer({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "crit"; text: string } | null>(null);

  async function importFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setNote(null);
    let created = 0;
    let updated = 0;
    let failed = 0;
    try {
      for (const file of Array.from(files)) {
        const text = await file.text();
        let body: unknown;
        if (file.name.toLowerCase().endsWith(".md")) {
          body = { markdown: text };
        } else {
          try {
            body = JSON.parse(text);
          } catch {
            failed += 1;
            continue;
          }
        }
        const res = await fetch("/api/v1/admin/articles/import", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
        });
        if (!res.ok) {
          failed += 1;
          continue;
        }
        const report = (await res.json()) as { created: number; updated: number; failed: number };
        created += report.created;
        updated += report.updated;
        failed += report.failed;
      }
      setNote({
        tone: failed > 0 ? "crit" : "ok",
        text: t("admin.transfer.report", { created, updated, failed }),
      });
      if (created + updated > 0) {
        // Server-Komponente neu laden, damit die Liste den Import zeigt.
        setTimeout(() => window.location.reload(), 1200);
      }
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <a href="/api/v1/admin/articles/export" download>
        <Button variant="ghost" size="sm">
          {t("admin.transfer.export")}
        </Button>
      </a>
      <Button
        variant="ghost"
        size="sm"
        disabled={busy}
        onClick={() => fileRef.current?.click()}
      >
        {busy ? t("admin.transfer.importing") : t("admin.transfer.import")}
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".json,.md"
        multiple
        className="hidden"
        aria-label={t("admin.transfer.import")}
        onChange={(e) => void importFiles(e.target.files)}
      />
      {note ? (
        <span className={note.tone === "ok" ? "text-xs text-ok" : "text-xs text-crit"}>
          {note.text}
        </span>
      ) : null}
    </div>
  );
}
