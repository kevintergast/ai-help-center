"use client";

import { useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { LinkIcon } from "@/components/ui/icons";

/**
 * TEILEN-BUTTON neben einer Überschrift: Klick kopiert die vollständige URL
 * mit `#anker` in die Zwischenablage — so kann man Kunden direkt auf einen
 * ABSCHNITT verweisen (Vorbild: help.smao.ai).
 *
 * Bewusst ein echter `<a href="#anker">`: ohne JS bleibt es eine funktionierende
 * Sprungmarke, mit JS kommt das Kopieren dazu (Progressive Enhancement).
 * Sichtbar wird er beim Überfahren der Überschrift (group-hover) — und immer,
 * sobald er den Tastaturfokus hat.
 */
export function HeadingAnchor({ id, locale }: { id: string; locale: Locale }) {
  const t = getT(locale);
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      const url = `${window.location.origin}${window.location.pathname}#${id}`;
      await navigator.clipboard.writeText(url);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    } catch {
      /* Clipboard verweigert (http/Permissions) — der Anker-Sprung greift trotzdem */
    }
  }

  return (
    <a
      href={`#${id}`}
      onClick={() => void copy()}
      aria-label={t("hc.anchor.copy")}
      title={copied ? t("hc.anchor.copied") : t("hc.anchor.copy")}
      className="ml-2 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full align-middle text-ink-muted opacity-0 transition-opacity hover:bg-tint hover:text-brand focus-visible:opacity-100 focus-visible:outline-none focus-visible:shadow-focusglow group-hover/heading:opacity-100"
    >
      {copied ? (
        <span aria-hidden className="text-xs font-semibold text-ok">✓</span>
      ) : (
        <LinkIcon width={13} height={13} aria-hidden />
      )}
    </a>
  );
}
