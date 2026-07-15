"use client";

import { useCallback, useEffect, useState } from "react";
import { getT } from "@/i18n/t";
import type { MessageKey } from "@/i18n/messages/de";
import type { Locale } from "@/lib/tenant/types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/input";
import { ErrorNote } from "@/components/auth/notes";

/**
 * RECHTSTEXTE-VERWALTUNG (Design h) in den Einstellungen: pro Dokument
 * (Impressum/Datenschutz/AGB) entweder ein externer Link ODER Markdown —
 * eingefügt oder als .md-Datei hochgeladen (wird clientseitig gelesen, es
 * gibt keinen Datei-Speicher; die API validiert https-Whitelist bzw.
 * 100-KB-Limit). Mutationen sind serverseitig OWNER-exklusiv; 403 zeigt den
 * Hinweis. Öffentlich erscheinen die Texte unter /legal/<doc> (Footer-Links).
 */

type DocType = "imprint" | "privacy" | "terms";
type Mode = "link" | "markdown";

interface DocStatus {
  docType: DocType;
  present: boolean;
  mode: Mode | null;
  updatedAt: number | null;
}

const DOC_LABEL: Record<DocType, MessageKey> = {
  imprint: "hc.legal.imprint",
  privacy: "hc.legal.privacy",
  terms: "hc.legal.terms",
};

const ERROR_KEYS: Record<string, MessageKey> = {
  invalid_url: "admin.legal.error.invalidUrl",
  markdown_required: "admin.legal.error.markdownRequired",
  markdown_too_large: "admin.legal.error.tooLarge",
};

export function LegalDocsManager({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const [docs, setDocs] = useState<DocStatus[] | null>(null);
  const [open, setOpen] = useState<DocType | null>(null);
  const [mode, setMode] = useState<Mode>("link");
  const [url, setUrl] = useState("");
  const [markdown, setMarkdown] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/admin/legal", { headers: { accept: "application/json" } });
      if (res.ok) setDocs(((await res.json()) as { docs: DocStatus[] }).docs);
      else setDocs([]);
    } catch {
      setDocs([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function openEditor(docType: DocType, present: boolean) {
    setOpen(docType);
    setError("");
    setMode("link");
    setUrl("");
    setMarkdown("");
    if (!present) return;
    // Bestehenden Inhalt zum Bearbeiten vorbefüllen (public Read, tenant-scoped).
    try {
      const res = await fetch(`/api/v1/legal/${docType}`, {
        headers: { accept: "application/json" },
      });
      if (!res.ok) return;
      const doc = (await res.json()) as { mode: Mode; url?: string; markdown?: string };
      setMode(doc.mode);
      setUrl(doc.url ?? "");
      setMarkdown(doc.markdown ?? "");
    } catch {
      /* leer starten */
    }
  }

  async function mutate(method: "PUT" | "DELETE", docType: DocType, body?: unknown) {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/v1/admin/legal/${docType}`, {
        method,
        headers: {
          accept: "application/json",
          ...(body !== undefined ? { "content-type": "application/json" } : {}),
        },
        ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
      });
      if (res.ok) {
        await load();
        setOpen(null);
        return;
      }
      if (res.status === 403) {
        setError(t("admin.legal.ownerOnly"));
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(t(ERROR_KEYS[data?.error ?? ""] ?? "admin.legal.error.generic"));
    } catch {
      setError(t("admin.legal.error.generic"));
    } finally {
      setBusy(false);
    }
  }

  function save(docType: DocType) {
    void mutate(
      "PUT",
      docType,
      mode === "link" ? { mode, url: url.trim() } : { mode, markdown },
    );
  }

  function readFile(file: File) {
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") setMarkdown(reader.result);
    };
    reader.readAsText(file);
  }

  if (!docs) return <p className="text-sm text-ink-muted">{t("admin.legal.loading")}</p>;

  return (
    <div className="flex flex-col gap-3">
      <p className="-mt-1 text-xs text-ink-muted">{t("admin.legal.intro")}</p>
      {(["imprint", "privacy", "terms"] as const).map((docType) => {
        const status = docs.find((d) => d.docType === docType);
        const present = status?.present ?? false;
        const isOpen = open === docType;
        return (
          <div key={docType} className="rounded-card border border-hairline p-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="min-w-32 font-medium text-ink">{t(DOC_LABEL[docType])}</span>
              {present ? (
                <Badge tone="ok" dot>
                  {status?.mode === "link" ? t("admin.legal.modeLink") : t("admin.legal.modeMarkdown")}
                </Badge>
              ) : (
                <Badge tone="warn" dot>
                  {t("admin.legal.missing")}
                </Badge>
              )}
              <span className="ml-auto flex gap-2">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => (isOpen ? setOpen(null) : void openEditor(docType, present))}
                >
                  {isOpen ? t("admin.legal.cancel") : t("admin.legal.edit")}
                </Button>
                {present ? (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={busy}
                    onClick={() => void mutate("DELETE", docType)}
                  >
                    {t("admin.legal.remove")}
                  </Button>
                ) : null}
              </span>
            </div>

            {isOpen ? (
              <div className="mt-4 flex flex-col gap-3 border-t border-hairline pt-4">
                <div className="flex gap-2">
                  <Button
                    variant={mode === "link" ? "primary" : "ghost"}
                    size="sm"
                    onClick={() => setMode("link")}
                  >
                    {t("admin.legal.modeLink")}
                  </Button>
                  <Button
                    variant={mode === "markdown" ? "primary" : "ghost"}
                    size="sm"
                    onClick={() => setMode("markdown")}
                  >
                    {t("admin.legal.modeMarkdown")}
                  </Button>
                </div>

                {mode === "link" ? (
                  <Input
                    label={t("admin.legal.urlLabel")}
                    value={url}
                    onChange={(e) => setUrl(e.target.value)}
                    placeholder={t("admin.legal.urlPlaceholder")}
                    className="max-w-xl"
                  />
                ) : (
                  <>
                    <Textarea
                      label={t("admin.legal.markdownLabel")}
                      value={markdown}
                      onChange={(e) => setMarkdown(e.target.value)}
                      rows={10}
                      placeholder={t("admin.legal.markdownPlaceholder")}
                    />
                    <label className="inline-flex w-fit cursor-pointer items-center gap-2 rounded-std border border-hairline px-3 py-1.5 text-sm text-ink transition-colors hover:bg-tint">
                      {t("admin.legal.upload")}
                      <input
                        type="file"
                        accept=".md,.markdown,.txt,text/markdown,text/plain"
                        className="sr-only"
                        onChange={(e) => {
                          const file = e.target.files?.[0];
                          if (file) readFile(file);
                          e.target.value = "";
                        }}
                      />
                    </label>
                  </>
                )}

                <ErrorNote>{error || null}</ErrorNote>
                <div>
                  <Button
                    size="sm"
                    disabled={busy || (mode === "link" ? url.trim().length === 0 : markdown.trim().length === 0)}
                    onClick={() => save(docType)}
                  >
                    {busy ? t("admin.legal.saving") : t("admin.legal.save")}
                  </Button>
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
