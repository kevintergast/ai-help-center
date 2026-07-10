import type { ReactNode } from "react";
import { cn } from "@/lib/ui/cn";

export interface ArticleCardProps {
  category: ReactNode;
  title: ReactNode;
  excerpt: ReactNode;
  /** Statusbadge-Slot (z. B. <Badge tone="ok">…). */
  status?: ReactNode;
  className?: string;
}

/** Artikel-Karte mit Farb-Thumbnail (Rand statt Schatten). */
export function ArticleCard({ category, title, excerpt, status, className }: ArticleCardProps) {
  return (
    <article
      className={cn(
        "group cursor-pointer overflow-hidden rounded-card border border-hairline bg-surface transition-colors duration-150 hover:border-hairline-strong",
        className,
      )}
    >
      <div
        className="h-28"
        style={{
          background:
            "linear-gradient(135deg, color-mix(in srgb, var(--brand-primary) 22%, var(--surface)), var(--surface))",
        }}
      />
      <div className="px-[18px] py-4">
        <span className="text-xs uppercase tracking-[0.04em] text-brand">{category}</span>
        <h4 className="mb-1.5 mt-1 text-[17px] font-semibold tracking-[-0.2px] text-ink">
          {title}
        </h4>
        <p className="mb-3 text-sm leading-snug text-ink-muted">{excerpt}</p>
        {status}
      </div>
    </article>
  );
}
