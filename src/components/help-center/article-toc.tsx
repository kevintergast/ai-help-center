import type { ArticleHeading } from "@/lib/content/headings";

/**
 * INHALTSVERZEICHNIS der Artikelseite: Sprungmarken auf die Überschriften-Anker
 * (dieselben Ids wie die Teilen-Buttons — beide aus `articleHeadings`).
 *
 * Bewusst reine `<a href="#…">`: kein JavaScript, kein State, funktioniert
 * server-gerendert und im Ausdruck. Die gemessene Realität in Hilfezentren sind
 * ~9 Überschriften pro Artikel; unter drei Überschriften lohnt die Liste nicht
 * und würde nur Fläche kosten (der Aufrufer prüft `hasToc`).
 */

export const TOC_MIN_HEADINGS = 3;

/** Lohnt ein Inhaltsverzeichnis? (Kurze Artikel bleiben ohne.) */
export function hasToc(headings: ArticleHeading[]): boolean {
  return headings.length >= TOC_MIN_HEADINGS;
}

export function ArticleToc({
  headings,
  label,
  className = "",
}: {
  headings: ArticleHeading[];
  label: string;
  className?: string;
}) {
  if (!hasToc(headings)) return null;
  return (
    <nav aria-label={label} className={className}>
      <h2 className="mb-3 text-sm uppercase tracking-[0.08em] text-ink-muted">{label}</h2>
      <ul className="flex flex-col gap-1 border-l border-hairline">
        {headings.map((h) => (
          <li key={h.id}>
            <a
              href={`#${h.id}`}
              className={`-ml-px block border-l-2 border-transparent py-1 text-sm text-ink-muted transition-colors hover:border-brand hover:text-brand ${
                h.level === 3 ? "pl-6" : "pl-3"
              }`}
            >
              {h.text}
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}
