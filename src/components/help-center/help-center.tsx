"use client";

import { useMemo, useState, type ReactNode } from "react";
import type { Locale } from "@/lib/tenant/types";
import type { MessageKey } from "@/i18n/messages/de";
import { getT } from "@/i18n/t";
import type {
  Article,
  ArticleStatus,
  ArticleSummary,
  AskAnswer,
  CategoryGroup,
  HelpCenterData,
} from "@/lib/content/types";
import { askStub } from "@/lib/content/fake-repo";
import { cn } from "@/lib/ui/cn";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { IconButton } from "@/components/ui/icon-button";
import { PromptBox } from "@/components/ui/prompt-box";
import { SearchCombobox } from "@/components/ui/search-combobox";
import { AnswerBlock } from "@/components/ui/answer-block";
import { FeedbackBar } from "@/components/ui/feedback-bar";
import { Dialog } from "@/components/ui/dialog";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  ArrowLeftIcon,
  CloseIcon,
  DocIcon,
  MenuIcon,
  PlayIcon,
  SparkleIcon,
  ChevronDownIcon,
} from "@/components/ui/icons";

type T = ReturnType<typeof getT>;

const STATUS: Record<ArticleStatus, { tone: "ok" | "warn" | "brand" | "neutral"; key: MessageKey }> = {
  current: { tone: "ok", key: "hc.status.current" },
  stale: { tone: "warn", key: "hc.status.stale" },
  ai: { tone: "brand", key: "hc.status.ai" },
  draft: { tone: "neutral", key: "hc.status.draft" },
};

function StatusBadge({ t, status }: { t: T; status: ArticleStatus }) {
  const s = STATUS[status];
  return (
    <Badge tone={s.tone} dot>
      {t(s.key)}
    </Badge>
  );
}

type View =
  | { kind: "welcome" }
  | { kind: "article"; id: string }
  | { kind: "answer"; answer: AskAnswer };

export interface HelpCenterProps {
  locale: Locale;
  tenantName: string;
  logoUrl: string | null;
  /** Serverseitig aufgelöstes Lese-Bundle (D1 oder Sample-Fallback). */
  data: HelpCenterData;
}

export function HelpCenter({ locale, tenantName, logoUrl, data }: HelpCenterProps) {
  const t = getT(locale);
  const groups = data.groups;
  const searchItems = useMemo(
    () => data.searchItems.map((a) => ({ id: a.id, title: a.title, category: a.category })),
    [data.searchItems],
  );
  // Detail-/Verwandten-/Quellen-Lookups laufen lokal über das vorab geladene Bundle.
  const articleById = useMemo(
    () => new Map(data.articles.map((a) => [a.id, a])),
    [data.articles],
  );
  const getArticle = (id: string): Article | null => articleById.get(id) ?? null;

  const [view, setView] = useState<View>({ kind: "welcome" });
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [promptCollapsed, setPromptCollapsed] = useState(false);
  const [dialog, setDialog] = useState<"roadmap" | "changelog" | null>(null);

  function openArticle(id: string) {
    setView({ kind: "article", id });
    setSidebarOpen(false);
  }
  function ask(text: string) {
    // RAG-STUB (Punkt 3): lokale, geerdete Beispielantwort über das Bundle.
    setView({ kind: "answer", answer: askStub(text, data.articles) });
    setSidebarOpen(false);
  }
  function goHome() {
    setView({ kind: "welcome" });
    setSidebarOpen(false);
  }

  const activeId = view.kind === "article" ? view.id : null;

  const sidebar = (
    <div className="flex h-full flex-col gap-5 p-4">
      <SearchCombobox
        items={searchItems}
        placeholder={t("hc.searchPlaceholder")}
        emptyLabel={t("hc.searchEmpty")}
        aria-label={t("hc.searchAria")}
        onSelect={(it) => openArticle(it.id)}
      />
      <nav aria-label={t("hc.articlesHeading")} className="flex flex-col gap-5 overflow-y-auto">
        {groups.map((g) => (
          <div key={g.category}>
            <p className="mb-1.5 px-2 text-xs uppercase tracking-[0.08em] text-ink-muted">
              {g.category}
            </p>
            <ul className="flex flex-col gap-0.5">
              {g.articles.map((a) => (
                <li key={a.id}>
                  <button
                    onClick={() => openArticle(a.id)}
                    aria-current={activeId === a.id}
                    className={cn(
                      "flex w-full items-center gap-2 rounded-comfy px-2 py-1.5 text-left text-sm transition-colors",
                      activeId === a.id
                        ? "bg-tint font-medium text-ink"
                        : "text-ink-muted hover:bg-tint hover:text-ink",
                    )}
                  >
                    <DocIcon width={15} height={15} className="shrink-0 opacity-70" />
                    <span className="truncate">{a.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </nav>
    </div>
  );

  return (
    <div className="flex min-h-screen flex-col bg-surface text-ink">
      {/* Top bar */}
      <header className="sticky top-0 z-30 border-b border-hairline bg-surface">
        <div className="mx-auto flex w-full max-w-[1280px] items-center gap-3 px-4 py-3">
          <IconButton
            aria-label={t("hc.openMenu")}
            onClick={() => setSidebarOpen(true)}
            className="h-9 w-9 shadow-none md:hidden"
          >
            <MenuIcon width={18} height={18} />
          </IconButton>
          <button
            onClick={goHome}
            aria-label={t("hc.home")}
            className="flex items-center gap-2.5 rounded-std focus-visible:outline-none focus-visible:shadow-focusglow"
          >
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={logoUrl} alt={tenantName} className="h-7 w-auto" />
            ) : (
              <span className="grid h-8 w-8 place-items-center rounded-comfy bg-brand text-sm font-semibold text-brand-fg">
                {tenantName.charAt(0)}
              </span>
            )}
            <span className="font-semibold tracking-[-0.3px]">{tenantName}</span>
          </button>
          <div className="ml-auto flex items-center gap-1.5">
            <Button variant="cream" size="sm" onClick={() => setDialog("roadmap")}>
              {t("hc.roadmap")}
            </Button>
            <Button variant="cream" size="sm" onClick={() => setDialog("changelog")}>
              {t("hc.changelog")}
            </Button>
            <ThemeToggle label={t("hc.themeToggle")} />
          </div>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1280px] flex-1">
        {/* Desktop sidebar */}
        <aside className="hidden w-72 shrink-0 border-r border-hairline md:block">
          <div className="sticky top-[61px] max-h-[calc(100vh-61px)]">{sidebar}</div>
        </aside>

        {/* Mobile drawer */}
        {sidebarOpen ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <div
              className="absolute inset-0 bg-black/40"
              onClick={() => setSidebarOpen(false)}
              aria-hidden
            />
            <div className="absolute inset-y-0 left-0 w-80 max-w-[85%] overflow-y-auto border-r border-hairline bg-surface">
              <div className="flex justify-end p-2">
                <IconButton
                  aria-label={t("hc.closeMenu")}
                  onClick={() => setSidebarOpen(false)}
                  className="h-9 w-9 shadow-none"
                >
                  <CloseIcon width={18} height={18} />
                </IconButton>
              </div>
              {sidebar}
            </div>
          </div>
        ) : null}

        {/* Main */}
        <main className="min-w-0 flex-1 px-5 py-8 pb-44 md:px-10">
          {view.kind === "welcome" ? (
            <WelcomeView t={t} groups={groups} onOpen={openArticle} />
          ) : view.kind === "article" ? (
            <ArticleView t={t} id={view.id} getArticle={getArticle} onOpen={openArticle} onBack={goHome} />
          ) : (
            <AnswerView t={t} answer={view.answer} getArticle={getArticle} onOpen={openArticle} onBack={goHome} />
          )}
        </main>
      </div>

      {/* Fixed AI prompt bar */}
      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-surface to-transparent px-4 pb-4 pt-10">
        <div className="mx-auto max-w-3xl">
          {promptCollapsed ? (
            <button
              onClick={() => setPromptCollapsed(false)}
              className="mx-auto flex items-center gap-2 rounded-full border border-hairline bg-surface-raised px-4 py-2.5 text-sm text-ink shadow-focusglow"
            >
              <SparkleIcon width={16} height={16} className="text-brand" />
              {t("hc.promptExpand")}
            </button>
          ) : (
            <div className="relative">
              <div className="mb-2 flex justify-center">
                <button
                  onClick={() => setPromptCollapsed(true)}
                  className="flex items-center gap-1 rounded-full border border-hairline bg-surface-raised px-3 py-1 text-xs text-ink-muted shadow-sm"
                >
                  <ChevronDownIcon width={14} height={14} />
                  {t("hc.promptCollapse")}
                </button>
              </div>
              <PromptBox
                placeholder={t("hc.promptPlaceholder")}
                modes={[
                  { id: "ask", label: t("hc.modeAsk") },
                  { id: "search", label: t("hc.modeSearch") },
                ]}
                suggestions={data.suggestions}
                labels={{ send: t("hc.promptSend"), mic: t("hc.promptMic") }}
                onSubmit={(text) => ask(text)}
                className="shadow-focusglow"
              />
            </div>
          )}
        </div>
      </div>

      <Dialog
        open={dialog === "roadmap"}
        onClose={() => setDialog(null)}
        title={t("hc.roadmapTitle")}
        closeLabel={t("hc.close")}
      >
        <ul className="flex flex-col gap-3">
          {data.roadmap.map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-3">
              <span className="text-ink">{it.title}</span>
              <Badge tone={it.status === "shipped" ? "ok" : it.status === "in_progress" ? "brand" : "neutral"}>
                {t(`hc.roadmap.${it.status}` as MessageKey)}
              </Badge>
            </li>
          ))}
        </ul>
      </Dialog>

      <Dialog
        open={dialog === "changelog"}
        onClose={() => setDialog(null)}
        title={t("hc.changelogTitle")}
        closeLabel={t("hc.close")}
      >
        <ul className="flex flex-col gap-4">
          {data.changelog.map((c) => (
            <li key={c.id}>
              <div className="text-xs text-ink-muted">{c.dateLabel}</div>
              <div className="font-medium text-ink">{c.title}</div>
              <div className="text-sm text-ink-muted">{c.description}</div>
            </li>
          ))}
        </ul>
      </Dialog>
    </div>
  );
}

/* ————— Views ————— */

function WelcomeView({
  t,
  groups,
  onOpen,
}: {
  t: T;
  groups: CategoryGroup[];
  onOpen: (id: string) => void;
}) {
  const popular = groups.flatMap((g) => g.articles).slice(0, 4);
  return (
    <div className="mx-auto max-w-3xl">
      <h1 className="text-[34px] font-semibold leading-tight tracking-[-0.9px] [text-wrap:balance] md:text-[42px]">
        {t("hc.welcomeTitle")}
      </h1>
      <p className="mt-3 max-w-[58ch] text-lg leading-snug text-ink-muted">{t("hc.welcomeLede")}</p>
      <h2 className="mb-3 mt-10 text-sm uppercase tracking-[0.08em] text-ink-muted">
        {t("hc.popularHeading")}
      </h2>
      <div className="grid gap-3 sm:grid-cols-2">
        {popular.map((a) => (
          <button
            key={a.id}
            onClick={() => onOpen(a.id)}
            className="group flex flex-col gap-2 rounded-card border border-hairline bg-surface p-4 text-left transition-colors hover:border-hairline-strong"
          >
            <span className="text-xs uppercase tracking-[0.04em] text-brand">{a.category}</span>
            <span className="font-semibold tracking-[-0.2px] text-ink">{a.title}</span>
            <StatusBadge t={t} status={a.status} />
          </button>
        ))}
      </div>
    </div>
  );
}

function BackButton({ t, onBack }: { t: T; onBack: () => void }) {
  return (
    <button
      onClick={onBack}
      className="mb-6 inline-flex items-center gap-1.5 text-sm text-ink-muted transition-colors hover:text-ink"
    >
      <ArrowLeftIcon width={16} height={16} />
      {t("hc.backToOverview")}
    </button>
  );
}

function ArticleMiniList({
  heading,
  items,
  onOpen,
}: {
  heading: ReactNode;
  items: ArticleSummary[];
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) return null;
  return (
    <section className="mt-10">
      <h2 className="mb-3 text-sm uppercase tracking-[0.08em] text-ink-muted">{heading}</h2>
      <ul className="flex flex-col gap-2">
        {items.map((a) => (
          <li key={a.id}>
            <button
              onClick={() => onOpen(a.id)}
              className="flex w-full items-center gap-3 rounded-comfy border border-hairline bg-surface px-4 py-3 text-left transition-colors hover:bg-tint"
            >
              <DocIcon width={16} height={16} className="shrink-0 text-ink-muted" />
              <span className="flex-1 text-sm font-medium text-ink">{a.title}</span>
              <span className="text-xs text-ink-muted">{a.category}</span>
            </button>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ArticleView({
  t,
  id,
  getArticle,
  onOpen,
  onBack,
}: {
  t: T;
  id: string;
  getArticle: (id: string) => Article | null;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const article = getArticle(id);
  if (!article) return null;
  const related = article.relatedIds
    .map((rid) => getArticle(rid))
    .filter((a): a is NonNullable<typeof a> => a !== null);

  return (
    <div className="mx-auto max-w-4xl">
      <BackButton t={t} onBack={onBack} />
      <div className="flex flex-col gap-8 lg:flex-row">
        <article className="min-w-0 flex-1">
          <span className="text-xs uppercase tracking-[0.04em] text-brand">{article.category}</span>
          <h1 className="mb-3 mt-1.5 text-[30px] font-semibold leading-tight tracking-[-0.6px] [text-wrap:balance]">
            {article.title}
          </h1>
          <div className="mb-6 flex flex-wrap items-center gap-3 text-sm text-ink-muted">
            <StatusBadge t={t} status={article.status} />
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
          <ArticleMiniList heading={t("hc.relatedHeading")} items={related} onOpen={onOpen} />
        </article>

        {article.videos.length > 0 ? (
          <aside className="w-full shrink-0 lg:w-64">
            <h2 className="mb-3 text-sm uppercase tracking-[0.08em] text-ink-muted">
              {t("hc.videosHeading")}
            </h2>
            <ul className="flex flex-col gap-3">
              {article.videos.map((v) => (
                <li key={v.id}>
                  <button className="group w-full overflow-hidden rounded-card border border-hairline bg-surface text-left transition-colors hover:border-hairline-strong">
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
                  </button>
                </li>
              ))}
            </ul>
          </aside>
        ) : null}
      </div>
    </div>
  );
}

function AnswerView({
  t,
  answer,
  getArticle,
  onOpen,
  onBack,
}: {
  t: T;
  answer: AskAnswer;
  getArticle: (id: string) => Article | null;
  onOpen: (id: string) => void;
  onBack: () => void;
}) {
  const sources = answer.citations
    .map((c) => getArticle(c.id))
    .filter((a): a is NonNullable<typeof a> => a !== null);

  return (
    <div className="mx-auto max-w-3xl">
      <BackButton t={t} onBack={onBack} />
      <p className="text-xs uppercase tracking-[0.08em] text-ink-muted">{t("hc.answerHeading")}</p>
      <h1 className="mb-6 mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.5px] [text-wrap:balance]">
        {answer.question}
      </h1>
      <AnswerBlock
        heading={t("hc.answerHeading")}
        status={
          answer.grounded ? (
            <Badge tone="ok" dot>
              {t("hc.grounded", { count: answer.citations.length })}
            </Badge>
          ) : undefined
        }
      >
        {answer.body.map((p, i) => (
          <p key={i} className={i > 0 ? "mt-3" : undefined}>
            {p}
          </p>
        ))}
        <p className="mt-4 flex items-center gap-2 text-sm text-ink-muted">
          <SparkleIcon width={15} height={15} className="text-brand" />
          {t("hc.aiGeneratedNote")}
        </p>
      </AnswerBlock>
      <ArticleMiniList heading={t("hc.sourcesHeading")} items={sources} onOpen={onOpen} />
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
    </div>
  );
}
