import type { ReactNode } from "react";
import Link from "next/link";
import { LogoWithClaim } from "@/components/brand-mark";
import { getT } from "@/i18n/t";
import type { Locale } from "@/lib/tenant/types";

/**
 * Layout-Rahmen der Operator-Konsole (Punkt 4b) — Betreiber-Instanz
 * `app.hallofhelp.com`. Schlichter Header mit dem Logo mit Claim (einheitlich
 * mit HelpShell/AdminShell, User-Vorgabe 2026-07-15) + zentrierte
 * Inhaltsspalte. Server-Komponente; das Branding (CSS-Variablen) liegt global
 * auf <html> (Root-Layout).
 */
export function OperatorShell({ locale, children }: { locale: Locale; children: ReactNode }) {
  const t = getT(locale);
  return (
    <div className="min-h-screen bg-surface text-ink">
      <header className="border-b border-hairline">
        <div className="mx-auto flex h-14 w-full max-w-3xl items-center px-5">
          <Link href="/" aria-label={t("hc.home")} className="inline-flex items-center">
            <LogoWithClaim alt={t("operator.brand")} className="h-8 w-auto" />
          </Link>
        </div>
      </header>
      <main className="mx-auto w-full max-w-3xl px-5 py-10">{children}</main>
    </div>
  );
}
