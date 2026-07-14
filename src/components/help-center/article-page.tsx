import Link from "next/link";
import type { Locale } from "@/lib/tenant/types";
import type { Article, ArticleStatus, ArticleSummary, HelpCenterData } from "@/lib/content/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import { HelpShell } from "./help-shell";
import { ArticleAskPrompt } from "./article-ask-prompt";
import { Badge } from "@/components/ui/badge";
import { FeedbackBar } from "@/components/ui/feedback-bar";
import { ArrowLeftIcon, DocIcon, PlayIcon } from "@/components/ui/icons";

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
  article: Article;
  /** Bereits aufgelöste verwandte Artikel (mit slug für die Verlinkung). */
  related: ArticleSummary[];
  /** Lese-Bundle für Sidebar/Navigation/Prompt-Vorschläge. */
  data: HelpCenterData;
}

export function ArticlePage({
  locale,
  tenantName,
  logoUrl,
  article,
  related,
  data,
}: ArticlePageProps) {
  const t = getT(locale);
  const s = STATUS[article.status];

  return (
    <HelpShell
      locale={locale}
      tenantName={tenantName}
      logoUrl={logoUrl}
      data={data}
      activeSlug={article.slug}
      footer={<ArticleAskPrompt locale={locale} suggestions={data.suggestions} />}
    >
      <div className="px-5 py-8 md:px-10">
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
            </div>
            <div className="flex flex-col gap-4 text-[15px] leading-relaxed text-ink">
              {article.body.map((p, i) => (
                <p key={i}>{p}</p>
              ))}
            </div>
            <div className="mt-8">
              <FeedbackBar
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
              <ul className="flex flex-col gap-3">
                {article.videos.map((v) => (
                  <li key={v.id}>
                    <div className="overflow-hidden rounded-card border border-hairline bg-surface">
                      <span
                        className="flex h-28 items-center justify-center"
                        style={{
                          background:
                            "linear-gradient(135deg, color-mix(in srgb, var(--brand-primary) 24%, var(--surface)), var(--surface))",
                        }}
                      >
                        <PlayIcon width={30} height={30} className="text-ink opacity-80" />
                      </span>
                      <span className="flex items-center justify-between gap-2 px-3 py-2.5">
                        <span className="text-sm font-medium text-ink">{v.title}</span>
                        <span className="shrink-0 text-xs tabular-nums text-ink-muted">
                          {v.durationLabel}
                        </span>
                      </span>
                    </div>
                  </li>
                ))}
              </ul>
            </aside>
          ) : null}
        </div>
      </div>
    </HelpShell>
  );
}
