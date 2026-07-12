import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { InfoIcon, WarnIcon } from "@/components/ui/icons";

/**
 * Fehler-Hinweis: `role="alert"` + `aria-live="assertive"`, damit Screenreader
 * jeden Statuswechsel (z. B. fehlgeschlagener Login) ansagen. Rendert NICHTS,
 * wenn keine Meldung anliegt — der Live-Region-Container bleibt im DOM, damit
 * spätere Meldungen zuverlässig angesagt werden.
 */
export function ErrorNote({ children }: { children?: ReactNode }) {
  return (
    <div role="alert" aria-live="assertive" className="empty:hidden">
      {children ? (
        <div className="flex items-start gap-2.5 rounded-std border border-crit-bd bg-crit-bg p-3 text-sm text-crit">
          <WarnIcon width={18} height={18} className="mt-0.5 shrink-0" />
          <span>{children}</span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Status-/Erfolgs-Hinweis: `role="status"` + `aria-live="polite"` (nicht so
 * dringlich wie ein Fehler). Tone `ok` für Erfolg, `info` für neutrale Hinweise.
 */
export function PendingNote({
  tone = "info",
  children,
}: {
  tone?: "ok" | "info";
  children: ReactNode;
}) {
  return (
    <div
      role="status"
      aria-live="polite"
      className={cn(
        "flex items-start gap-2.5 rounded-std border p-3 text-sm",
        tone === "ok"
          ? "border-ok-bd bg-ok-bg text-ok"
          : "border-hairline bg-surface-raised text-ink-muted",
      )}
    >
      <InfoIcon width={18} height={18} className="mt-0.5 shrink-0" />
      <span>{children}</span>
    </div>
  );
}
