"use client";

import type { Locale } from "@/lib/tenant/types";
import type { AnswerPart, Citation } from "@/lib/content/types";
import { getT } from "@/i18n/t";
import { DocIcon } from "@/components/ui/icons";

/**
 * KÖRPER DES DYNAMISCHEN HILFEARTIKELS.
 *
 * Früher war das eine Folge gleich aussehender Absätze, und die Herkunft stand
 * gesammelt am Fuß. Wer wissen wollte, WORAUF ein bestimmter Satz beruht,
 * konnte es nicht herausfinden. Jetzt trägt jeder Baustein seinen Beleg
 * direkt unter sich — klein und leise, damit er nicht mit dem Inhalt
 * konkurriert, aber genau dort, wo die Frage aufkommt.
 *
 * SCHRITTE sind eigene Bausteine und werden HIER nummeriert, nicht vom
 * Modell: So kann es keine Lücken, Dopplungen oder falsche Reihenfolgen
 * erfinden, und die Nummern stimmen auch dann, wenn ein Baustein beim Parsen
 * verworfen wurde.
 *
 * RÜCKFALL: Ältere gespeicherte Antworten (und solche, deren Format nicht
 * trug) haben nur `body`. Die rendern wir unverändert als Absätze — eine
 * schlichtere Anzeige ist besser als eine leere.
 */

export function AnswerBody({
  locale,
  parts,
  body,
  citations,
  onOpen,
}: {
  locale: Locale;
  parts?: AnswerPart[];
  body: string[];
  citations: Citation[];
  /** Artikel im Hilfezentrum öffnen (Quelle anklicken). */
  onOpen?: (articleId: string) => void;
}) {
  const t = getT(locale);

  if (!parts || parts.length === 0) {
    return (
      <>
        {body.map((p, i) => (
          <p key={i} className={i > 0 ? "mt-3" : undefined}>
            {p}
          </p>
        ))}
      </>
    );
  }

  // Schritt-Nummern fortlaufend über die ANGEZEIGTEN Schritte.
  let step = 0;
  return (
    <div className="flex flex-col gap-4">
      {parts.map((part, i) => {
        const cite = part.source !== undefined ? citations[part.source] : undefined;
        const source = cite ? <SourceLink t={t} citation={cite} onOpen={onOpen} /> : null;

        if (part.kind === "image") {
          // Ohne Slug gibt es keine öffentliche Bild-Route — dann lieber
          // nichts zeigen als ein kaputtes Bild.
          if (!cite?.slug) return null;
          return (
            <figure key={i}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={`/api/v1/content/images/${cite.slug}/${part.imageId}`}
                alt={part.alt}
                loading="lazy"
                className="w-full rounded-comfy border border-hairline bg-surface"
              />
              <figcaption className="mt-1.5 text-xs text-ink-muted">{part.alt}</figcaption>
              {source}
            </figure>
          );
        }

        if (part.kind === "step") {
          step += 1;
          return (
            <div key={i} className="flex gap-3">
              <span
                aria-hidden
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-brand/10 text-xs font-semibold text-brand"
              >
                {step}
              </span>
              <div className="min-w-0">
                {/* Für Vorlese-Software ist die Ziffer oben dekorativ. */}
                <p>
                  <span className="sr-only">{t("hc.answer.step", { n: String(step) })} </span>
                  {part.text}
                </p>
                {source}
              </div>
            </div>
          );
        }

        return (
          <div key={i}>
            <p>{part.text}</p>
            {source}
          </div>
        );
      })}
    </div>
  );
}

/** Leiser Beleg unter einem Baustein — Symbol plus Artikeltitel. */
function SourceLink({
  t,
  citation,
  onOpen,
}: {
  t: ReturnType<typeof getT>;
  citation: Citation;
  onOpen?: (articleId: string) => void;
}) {
  const label = citation.title;
  const kind = citation.kind ?? "article";
  const inner = (
    <>
      <DocIcon width={12} height={12} className="shrink-0" />
      <span className="truncate">{label}</span>
    </>
  );
  const className =
    "mt-1.5 inline-flex max-w-full items-center gap-1 text-xs text-ink-muted transition-colors";

  // Roadmap/Changelog haben keine eigene Seite — nur benennen, nicht verlinken.
  if (kind !== "article" || !onOpen) {
    return (
      <span className={className} title={t("hc.answer.sourceOf", { title: label })}>
        {inner}
      </span>
    );
  }
  return (
    <button
      type="button"
      onClick={() => onOpen(citation.id)}
      className={`${className} hover:text-brand`}
      title={t("hc.answer.sourceOf", { title: label })}
    >
      {inner}
    </button>
  );
}
