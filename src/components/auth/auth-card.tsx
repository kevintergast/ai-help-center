import type { ReactNode } from "react";

/**
 * Auth-Card: umrandeter Container mit Titel (h1) + optionalem Untertitel und
 * Formular-Inhalt. Server-kompatibel; Texte kommen bereits übersetzt vom
 * Aufrufer (i18n).
 */
export function AuthCard({
  title,
  subtitle,
  children,
  footer,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <section className="w-full rounded-card border border-hairline bg-surface p-6 sm:p-7">
      <header className="mb-5 flex flex-col gap-1.5">
        <h1 className="text-xl font-bold text-ink">{title}</h1>
        {subtitle ? <p className="text-sm text-ink-muted">{subtitle}</p> : null}
      </header>
      {children}
      {footer ? <div className="mt-6 text-center text-sm text-ink-muted">{footer}</div> : null}
    </section>
  );
}
