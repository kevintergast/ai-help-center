"use client";

import type { Locale } from "@/lib/tenant/types";
import type { AnswerPart, AnswerSegment, Citation } from "@/lib/content/types";
import { getT } from "@/i18n/t";
import { DocIcon, ExternalLinkIcon } from "@/components/ui/icons";

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

/**
 * Klick auf ein Ziel melden. `keepalive`, weil der Browser im selben Moment
 * die Seite verlässt — ein normaler fetch würde abgebrochen.
 *
 * Bewusst fire-and-forget: Scheitert die Meldung, hat der Leser trotzdem
 * bekommen, was er wollte. Eine Zählung ist kein Grund, einen Klick
 * aufzuhalten.
 */
function reportDestination(href: string): void {
  try {
    void fetch("/api/v1/events/destination", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ href }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    /* ignore */
  }
}

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

        if (part.kind === "link") {
          // ZIEL als eigener Knopf. `rel` ist Pflicht: Die Adresse zeigt in
          // ein fremdes Produkt, und der Referrer verriete, aus welchem
          // Hilfeartikel jemand kommt.
          return (
            // items-start + flex-col: Der Beleg gehört UNTER den Knopf. Als
            // bloßes <div> stünde er daneben, weil beide inline sind.
            <div key={i} className="flex flex-col items-start">
              <a
                href={part.href}
                target="_blank"
                rel="noopener noreferrer"
                data-destination={part.href}
                onClick={() => reportDestination(part.href)}
                className="inline-flex items-center gap-1.5 rounded-std bg-[var(--btn-primary-bg)] px-3.5 py-2 text-sm text-[var(--btn-primary-fg)] shadow-inset transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:shadow-focusglow"
              >
                {part.label}
                <ExternalLinkIcon width={14} height={14} />
              </a>
              {source}
            </div>
          );
        }

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
                  <Rich part={part} />
                </p>
                {source}
              </div>
            </div>
          );
        }

        return (
          <div key={i}>
            <p>
              <Rich part={part} />
            </p>
            {source}
          </div>
        );
      })}
    </div>
  );
}

/**
 * Baustein-Text, bei Bedarf mit Zielen MITTEN IM SATZ.
 *
 * Ohne `segments` ist es schlichter Text — so bleiben ältere gespeicherte
 * Antworten lesbar, die das Feld nicht kennen.
 */
function Rich({ part }: { part: { text: string; segments?: AnswerSegment[] } }) {
  if (!part.segments) return <>{part.text}</>;
  return (
    <>
      {part.segments.map((seg, i) =>
        seg.href ? (
          <a
            key={i}
            href={seg.href}
            target="_blank"
            rel="noopener noreferrer"
            data-destination={seg.href}
            onClick={() => reportDestination(seg.href!)}
            className="text-brand underline underline-offset-2 hover:no-underline"
          >
            {seg.text}
          </a>
        ) : (
          <span key={i}>{seg.text}</span>
        ),
      )}
    </>
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
