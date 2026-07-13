import type { ReactNode } from "react";
import { getT } from "@/i18n/t";
import type { Locale } from "@/lib/tenant/types";

/**
 * Layout-Rahmen der Operator-Konsole (Punkt 4b) — Betreiber-Instanz
 * `app.hallofhelp.app`. Schlichter Header mit Wortmarke + zentrierte
 * Inhaltsspalte. Server-Komponente; das Branding (CSS-Variablen) liegt global
 * auf <html> (Root-Layout).
 */
export function OperatorShell({ locale, children }: { locale: Locale; children: ReactNode }) {
  const t = getT(locale);
  return (
    <div className="min-h-screen bg-surface text-ink">
      <header className="border-b border-hairline">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center px-5">
          <span className="text-base font-bold text-ink">{t("operator.brand")}</span>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-5 py-10">{children}</main>
    </div>
  );
}
