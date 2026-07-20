import Link from "next/link";
import type { HelpViewer } from "@/lib/auth/viewer";
import type { Locale } from "@/lib/tenant/types";
import type { Article, ArticleStatus, ArticleSummary, HelpCenterData } from "@/lib/content/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import { HelpShell } from "./help-shell";
import { ArticleAskPrompt } from "./article-ask-prompt";
import { RichTextView } from "./rich-text-view";
import { ViewBeacon } from "./view-beacon";
import { Badge } from "@/components/ui/badge";
import { ArticleFeedback } from "./article-feedback";
import { ArticleVideos } from "./article-videos";
import { ArrowLeftIcon, DocIcon } from "@/components/ui/icons";

/**
 * SSR-Artikelseite (`/<slug>`). Servergerendert für SEO/Teilbarkeit — eigenes
 * `<title>`/Meta + JSON-LD kommen aus der Route. Der Artikelinhalt bleibt
 * serverseitig; Rahmen (Header + Navigation + KI-Eingabe unten) liefert die
 * gemeinsame HelpShell, damit die Chrome zur Startansicht identisch ist.
 */

const STATUS: Record<ArticleStatus, { tone: "ok" | "warn" | "brand" | "neutral"; key: MessageKey }> = {
  current: { tone: "ok", key: "hc.status.current" },
  stale: { tone: "warn", key: "hc.status.stale" },
  ai: { tone: "brand", key: "hc.status.ai" },
  draft: { tone: "neutral", key: "hc.status.draft" },
};

export interface ArticlePageProps {
  locale: Locale;
  tenantName: string;
  logoUrl: string | null;
  /** Dark-Mode-Logo (0023) — null: Dark Mode zeigt das helle. */
  logoDarkUrl?: string | null;
  article: Article;
  /** Bereits aufgelöste verwandte Artikel (mit slug für die Verlinkung). */
  related: ArticleSummary[];
  /** Lese-Bundle für Sidebar/Navigation/Prompt-Vorschläge. */
  data: HelpCenterData;
  /** Operator-Instanz (app.*) → CTA „Eigenes Hilfezentrum erstellen". */
  isOperator?: boolean;
  /** Angemeldeter Betrachter (serverseitig gelesen) → Konto-Popup im Header. */
  viewer?: HelpViewer | null;
  /** Veröffentlichte Sprachfassungen des Sets (Sprachumschalter; leer = keiner). */
  siblings?: { locale: string; slug: string }[];
}

export function ArticlePage({
  locale,
  tenantName,
  logoUrl,
  logoDarkUrl = null,
  article,
  related,
  data,
  isOperator,
  viewer = null,
  siblings = [],
}: ArticlePageProps) {
  const t = getT(locale);
  const s = STATUS[article.status];

  return (
    <HelpShell
      locale={locale}
      tenantName={tenantName}
      logoUrl={logoUrl}
      logoDarkUrl={logoDarkUrl}
      data={data}
      isOperator={isOperator}
      viewer={viewer}
      activeSlug={article.slug}
      footer={<ArticleAskPrompt locale={locale} suggestions={data.suggestions} />}
    >
      <div className="px-5 py-8 md:px-10">
        {/* Nutzungs-Tracking (Infra-Plan Schritt 3): zählt den Aufruf serverseitig. */}
        <ViewBeacon slug={article.slug} />
        <Link
          href="/"
          className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
        >
          <ArrowLeftIcon width={16} height={16} />
          {t("hc.backToOverview")}
        </Link>

        <div className="flex flex-col gap-8 lg:flex-row">
          <article className="min-w-0 max-w-4xl flex-1">
            <span className="text-xs uppercase tracking-[0.04em] text-brand">{article.category}</span>
            <h1 className="mb-3 mt-1.5 text-[30px] font-semibold leading-tight tracking-[-0.6px] [text-wrap:balance]">
              {article.title}
            </h1>
            <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
              <Badge tone={s.tone} dot>
                {t(s.key)}
              </Badge>
              <span>{t("hc.updated", { when: article.updatedLabel })}</span>
              <span aria-hidden>·</span>
              <span>{t("hc.readingTime", { min: article.readingMinutes })}</span>
              {siblings.length > 1 ? (
                <span
                  className="ml-auto inline-flex items-center gap-1"
                  aria-label={t("hc.languages")}
                >
                  {siblings.map((sib) => {
                    const active = sib.slug === article.slug;
                    return active ? (
                      <span
                        key={sib.locale}
                        className="rounded-full border border-brand bg-tint px-2.5 py-1 text-xs font-semibold uppercase text-brand"
                      >
                        {sib.locale}
                      </span>
                    ) : (
                      <Link
                        key={sib.locale}
                        href={`/${sib.slug}`}
                        className="rounded-full border border-hairline px-2.5 py-1 text-xs font-semibold uppercase text-ink-muted transition-colors hover:text-ink"
                      >
                        {sib.locale}
                      </Link>
                    );
                  })}
                </span>
              ) : null}
            </div>
            <div className="flex flex-col gap-4 text-[15px] leading-relaxed text-ink">
              <RichTextView body={article.body} />
            </div>
            {/* Vormerkungen (pending, Import) haben kein Binärbild → nie public. */}
            {(article.images?.filter((i) => !i.pending).length ?? 0) > 0 ? (
              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {article.images!.filter((i) => !i.pending).map((img) => (
                  <figure key={img.id}>
                    {/* Beschreibung = Alt-Text (Architektur-Pflicht, a11y). */}
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={`/api/v1/content/images/${article.slug}/${img.id}`}
                      alt={img.description}
                      loading="lazy"
                      className="w-full rounded-comfy border border-hairline bg-surface"
                    />
                    <figcaption className="mt-1.5 text-xs text-ink-muted">
                      {img.description}
                    </figcaption>
                  </figure>
                ))}
              </div>
            ) : null}
            <div className="mt-8">
              <ArticleFeedback
                slug={article.slug}
                labels={{
                  question: t("hc.feedbackQuestion"),
                  yes: t("hc.feedbackYes"),
                  no: t("hc.feedbackNo"),
                  thanks: t("hc.feedbackThanks"),
                }}
              />
            </div>

            {related.length > 0 ? (
              <section className="mt-10">
                <h2 className="mb-3 text-sm uppercase tracking-[0.08em] text-ink-muted">
                  {t("hc.relatedHeading")}
                </h2>
                <ul className="flex flex-col gap-2">
                  {related.map((a) => (
                    <li key={a.id}>
                      <Link
                        href={`/${a.slug}`}
                        className="flex w-full items-center gap-3 rounded-comfy border border-hairline bg-surface px-4 py-3 text-left transition-colors hover:bg-tint"
                      >
                        <DocIcon width={16} height={16} className="shrink-0 text-ink-muted" />
                        <span className="flex-1 text-sm font-medium text-ink">{a.title}</span>
                        <span className="text-xs text-ink-muted">{a.category}</span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </section>
            ) : null}
          </article>

          {article.videos.length > 0 ? (
            <aside className="w-full shrink-0 lg:w-64">
              <h2 className="mb-3 text-sm uppercase tracking-[0.08em] text-ink-muted">
                {t("hc.videosHeading")}
              </h2>
              {/* Klick-zum-Laden-Player (YouTube nocookie) — article-videos.tsx. */}
              <ArticleVideos videos={article.videos} playLabel={t("hc.videoPlay")} />
            </aside>
          ) : null}
        </div>
      </div>
    </HelpShell>
  );
}
