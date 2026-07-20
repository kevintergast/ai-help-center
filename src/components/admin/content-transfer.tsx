"use client";

import { useRef, useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { buildExampleImportFile, EXAMPLE_IMPORT_MARKDOWN } from "@/lib/content/import-examples";
import { Button } from "@/components/ui/button";

/**
 * IMPORT/EXPORT-Leiste der Artikel-Verwaltung (Content-Werkzeuge).
 *
 *  - Export: direkter Download der JSON-Datei (GET, funktioniert auch im
 *    Freeze — Anti-Lock-in).
 *  - Import: öffnet ein FORMAT-PANEL (die frühere Direkt-Dateiwahl ließ
 *    Nutzer raten, was die Datei enthalten muss): erklärt JSON- und
 *    Markdown-Form, bietet Beispieldateien zum Herunterladen (aus
 *    import-examples.ts — per Test gegen die echten Parser validiert) und
 *    erst dann die Dateiwahl. Der Server upsertet per Slug und liefert einen
 *    Bericht inkl. angelegter BILD-VORMERKUNGEN (Bilder reisen nie als
 *    Binärdaten mit); danach lädt die Seite neu.
 */
export function ContentTransfer({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "crit"; text: string } | null>(null);

  function downloadExample(kind: "json" | "md") {
    const content =
      kind === "json"
        ? JSON.stringify(buildExampleImportFile(), null, 2)
        : EXAMPLE_IMPORT_MARKDOWN;
    const blob = new Blob([content], {
      type: kind === "json" ? "application/json" : "text/markdown",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = kind === "json" ? "hallofhelp-import-beispiel.json" : "import-beispiel.md";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function importFiles(files: FileList | null) {
    if (!files || files.length === 0) return;
    setBusy(true);
    setNote(null);
    let created = 0;
    let updated = 0;
    let failed = 0;
    let pendingImages = 0;
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
        const report = (await res.json()) as {
          created: number;
          updated: number;
          failed: number;
          pendingImages?: number;
        };
        created += report.created;
        updated += report.updated;
        failed += report.failed;
        pendingImages += report.pendingImages ?? 0;
      }
      const summary = t("admin.transfer.report", { created, updated, failed });
      setNote({
        tone: failed > 0 ? "crit" : "ok",
        text:
          pendingImages > 0
            ? `${summary} ${t("admin.transfer.reportPending", { n: pendingImages })}`
            : summary,
      });
      setOpen(false);
      if (created + updated > 0) {
        // Server-Komponente neu laden, damit die Liste den Import zeigt.
        setTimeout(() => window.location.reload(), 1800);
      }
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  return (
    <div className="relative flex flex-wrap items-center gap-2">
      <a href="/api/v1/admin/articles/export" download>
        <Button variant="ghost" size="sm">
          {t("admin.transfer.export")}
        </Button>
      </a>
      <Button variant="ghost" size="sm" disabled={busy} onClick={() => setOpen((o) => !o)}>
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

      {open ? (
        <div className="absolute right-0 top-full z-20 mt-2 w-[380px] max-w-[90vw] rounded-card border border-hairline bg-surface p-4 shadow-lg">
          <strong className="mb-2 block text-sm font-semibold text-ink">
            {t("admin.transfer.helpTitle")}
          </strong>
          <div className="flex flex-col gap-2 text-xs leading-relaxed text-ink-muted">
            <p>
              <strong className="text-ink">JSON</strong> — {t("admin.transfer.helpJson")}
            </p>
            <p>
              <strong className="text-ink">Markdown</strong> — {t("admin.transfer.helpMd")}
            </p>
            <p>{t("admin.transfer.helpImages")}</p>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="cream" size="sm" onClick={() => downloadExample("json")}>
              {t("admin.transfer.exampleJson")}
            </Button>
            <Button variant="cream" size="sm" onClick={() => downloadExample("md")}>
              {t("admin.transfer.exampleMd")}
            </Button>
            <Button size="sm" disabled={busy} onClick={() => fileRef.current?.click()}>
              {t("admin.transfer.chooseFile")}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
