"use client";

import { useState } from "react";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { Button } from "@/components/ui/button";

/**
 * Einbett-Snippet fürs Widget (Settings): Copy-to-Clipboard des einen
 * Script-Tags. Host = Subdomain der Instanz (Loader + iframe + APIs laufen
 * damit first-party auf dem Tenant-Origin).
 */
export function WidgetSnippet({ locale, host }: { locale: Locale; host: string }) {
  const t = getT(locale);
  const snippet = `<script src="https://${host}/widget.js" async></script>`;
  const [copied, setCopied] = useState(false);

  async function copy() {
    try {
      await navigator.clipboard.writeText(snippet);
      setCopied(true);
      setTimeout(() => setCopied(false), 2500);
    } catch {
      /* Clipboard verweigert (http/Permissions) — Nutzer kopiert manuell */
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-sm text-ink-muted">{t("admin.settings.widget.hint")}</p>
      <pre className="overflow-x-auto rounded-std border border-hairline bg-surface-raised px-3 py-2.5 font-mono text-xs text-ink">
        {snippet}
      </pre>
      <div className="flex items-center gap-3">
        <Button size="sm" onClick={() => void copy()}>
          {t("admin.settings.widget.copy")}
        </Button>
        <span aria-live="polite" className="text-xs text-ok">
          {copied ? t("admin.settings.widget.copied") : null}
        </span>
      </div>
      <p className="text-xs text-ink-muted">{t("admin.settings.widget.billingNote")}</p>
    </div>
  );
}
