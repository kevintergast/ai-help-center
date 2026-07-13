import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";
import { SparkleIcon } from "./icons";

export interface Citation {
  n: number;
  title: ReactNode;
  href?: string;
}

export interface AnswerBlockProps {
  /** Kopfzeile, z. B. "KI-Antwort" (i18n-fähig, vom Aufrufer). */
  heading: ReactNode;
  /** Statusbadge-Slot (z. B. Grounding-Status). */
  status?: ReactNode;
  children: ReactNode;
  citations?: Citation[];
  className?: string;
}

/** Geerdete KI-Antwort mit Quellenangaben (Kernprodukt-Oberfläche). */
export function AnswerBlock({ heading, status, children, citations, className }: AnswerBlockProps) {
  return (
    <div className={cn("overflow-hidden rounded-card border border-hairline bg-surface", className)}>
      <div className="flex items-center gap-2.5 border-b border-hairline px-5 py-3.5">
        <span className="grid h-[26px] w-[26px] shrink-0 place-items-center rounded-std bg-brand p-1 text-brand-fg">
          <SparkleIcon width={15} height={15} />
        </span>
        <strong className="text-[15px] font-semibold text-ink">{heading}</strong>
        {status ? <span className="ml-auto">{status}</span> : null}
      </div>
      <div className="px-5 py-4 text-[15px] leading-relaxed text-ink">{children}</div>
      {citations && citations.length > 0 ? (
        <div className="flex flex-wrap gap-2 px-5 pb-4">
          {citations.map((c) => (
            <a
              key={c.n}
              href={c.href ?? "#"}
              className="inline-flex items-center gap-1.5 rounded-full border border-hairline bg-surface-raised px-2.5 py-1 text-[13px] text-ink-muted no-underline hover:border-hairline-strong"
            >
              <span className="grid h-4 w-4 place-items-center rounded-full bg-[var(--btn-primary-bg)] text-[10px] text-[var(--btn-primary-fg)]">
                {c.n}
              </span>
              {c.title}
            </a>
          ))}
        </div>
      ) : null}
    </div>
  );
}
