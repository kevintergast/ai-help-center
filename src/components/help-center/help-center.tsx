"use client";

import { useEffect, useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { HelpViewer } from "@/lib/auth/viewer";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import type { Article, ArticleSummary, AskAnswer, HelpCenterData } from "@/lib/content/types";
import { PENDING_ASK_KEY, OPEN_ANSWER_KEY } from "@/lib/content/handoff";
import {
  answerId,
  getSavedById,
  isSaved,
  removeSaved,
  saveAnswer,
  type SavedArticle,
} from "@/lib/content/saved-articles";
import { cn } from "@/lib/ui/cn";
import { HelpShell } from "./help-shell";
import { Badge } from "@/components/ui/badge";
import { PromptBox } from "@/components/ui/prompt-box";
import { AnswerBlock } from "@/components/ui/answer-block";
import { FeedbackBar } from "@/components/ui/feedback-bar";
import {
  ArrowLeftIcon,
  BookmarkCheckIcon,
  BookmarkIcon,
  DocIcon,
  SparkleIcon,
} from "@/components/ui/icons";

type T = ReturnType<typeof getT>;

type View =
  | { kind: "welcome" }
  | { kind: "loading"; question: string }
  | { kind: "answer"; answer: AskAnswer }
  | { kind: "error"; question: string; code: "frozen" | "unavailable" };

export interface HelpCenterProps {
  locale: Locale;
  tenantName: string;
  logoUrl: string | null;
  /** Serverseitig aufgelöstes Lese-Bundle (D1 oder Sample-Fallback). */
  data: HelpCenterData;
  /** Operator-Instanz (app.*) → CTA „Eigenes Hilfezentrum erstellen". */
  isOperator?: boolean;
  /** Angemeldeter Betrachter (serverseitig gelesen) → Konto-Popup im Header. */
  viewer?: HelpViewer | null;
}

export function HelpCenter({
  locale,
  tenantName,
  logoUrl,
  data,
  isOperator,
  viewer = null,
}: HelpCenterProps) {
  const t = getT(locale);
  const router = useRouter();
  const articleById = useMemo(() => new Map(data.articles.map((a) => [a.id, a])), [data.articles]);
  const slugById = useMemo(() => new Map(data.articles.map((a) => [a.id, a.slug])), [data.articles]);
  const getArticle = (id: string): Article | null => articleById.get(id) ?? null;

  const [view, setView] = useState<View>({ kind: "welcome" });

  async function ask(text: string) {
    // ECHTER RAG-Pfad (Punkt 3): POST /api/v1/ask → dynamischer KI-Artikel.
    // Nicht geerdet kommt als grounded:false zurück (AnswerView zeigt die
    // ehrliche No-Answer); frozen/Ausfall werden als Fehlerzustand gerendert.
    setView({ kind: "loading", question: text });
    try {
      const res = await fetch("/api/v1/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: text }),
      });
      if (res.ok) {
        setView({ kind: "answer", answer: (await res.json()) as AskAnswer });
        return;
      }
      setView({
        kind: "error",
        question: text,
        code: res.status === 402 ? "frozen" : "unavailable",
      });
    } catch {
      setView({ kind: "error", question: text, code: "unavailable" });
    }
  }
  function goHome() {
    setView({ kind: "welcome" });
  }
  function openArticle(id: string) {
    router.push(`/${slugById.get(id) ?? id}`);
  }
  function openSavedAnswer(s: SavedArticle) {
    setView({
      kind: "answer",
      answer: { question: s.question, body: s.body, citations: s.citations, grounded: s.grounded },
    });
  }

  // Handoffs anderer Ansichten (Artikelseite / Sidebar) via sessionStorage.
  useEffect(() => {
    try {
      const pending = sessionStorage.getItem(PENDING_ASK_KEY);
      if (pending) {
        sessionStorage.removeItem(PENDING_ASK_KEY);
        void ask(pending);
        return;
      }
      const openId = sessionStorage.getItem(OPEN_ANSWER_KEY);
      if (openId) {
        sessionStorage.removeItem(OPEN_ANSWER_KEY);
        const s = getSavedById(openId);
        if (s) openSavedAnswer(s);
      }
    } catch {
      /* ignore */
    }
     
  }, []);

  const promptModes = [
    { id: "ask", label: t("hc.modeAsk") },
    { id: "search", label: t("hc.modeSearch") },
  ];
  const promptLabels = { send: t("hc.promptSend"), mic: t("hc.promptMic") };

  return (
    <HelpShell
      locale={locale}
      tenantName={tenantName}
      logoUrl={logoUrl}
      data={data}
      isOperator={isOperator}
      viewer={viewer}
      onHome={goHome}
      onOpenSavedAnswer={openSavedAnswer}
      footer={
        view.kind !== "welcome" ? (
          <PromptBox
            expandable
            placeholder={t("hc.promptPlaceholder")}
            modes={promptModes}
            suggestions={data.suggestions}
            labels={promptLabels}
            onSubmit={(text) => void ask(text)}
          />
        ) : undefined
      }
    >
      {view.kind === "welcome" ? (
        <WelcomeView
          t={t}
          suggestions={data.suggestions}
          modes={promptModes}
          labels={promptLabels}
          onAsk={(text) => void ask(text)}
        />
      ) : view.kind === "loading" ? (
        <PendingAnswerView t={t} question={view.question} />
      ) : view.kind === "error" ? (
        <div className="px-5 py-8 md:px-10">
          <AskErrorView
            t={t}
            code={view.code}
            onBack={goHome}
            onRetry={() => void ask(view.question)}
          />
        </div>
      ) : (
        <div className="px-5 py-8 md:px-10">
          <AnswerView
            t={t}
            answer={view.answer}
            getArticle={getArticle}
            onOpen={openArticle}
            onBack={goHome}
          />
        </div>
      )}
    </HelpShell>
  );
}

/* ————— Views ————— */

function WelcomeView({
  t,
  suggestions,
  modes,
  labels,
  onAsk,
}: {
  t: T;
  suggestions: string[];
  modes: { id: string; label: string }[];
  labels: { send: string; mic: string };
  onAsk: (text: string) => void;
}) {
  // Startansicht: nur die KI-Eingabe, im Content eingebettet (kein Overlay).
  // Nimmt die Fläche ein, auf der später der dynamische Artikel erscheint.
  return (
    <div className="flex min-h-full flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-3xl">
        <h1 className="mb-6 text-center text-[30px] font-semibold leading-tight tracking-[-0.8px] [text-wrap:balance] md:text-[40px]">
          {t("hc.welcomeTitle")}
        </h1>
        <PromptBox
          placeholder={t("hc.promptPlaceholder")}
          modes={modes}
          suggestions={suggestions}
          labels={labels}
          onSubmit={(text) => onAsk(text)}
        />
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
      <div className="mb-6 flex items-start justify-between gap-4">
        <div className="min-w-0">
          <p className="text-xs uppercase tracking-[0.08em] text-ink-muted">{t("hc.answerHeading")}</p>
          <h1 className="mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.5px] [text-wrap:balance]">
            {answer.question}
          </h1>
        </div>
        {answer.grounded ? <SaveToggle t={t} answer={answer} /> : null}
      </div>
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
        {answer.body.length === 0 ? (
          <p className="text-ink-muted">{t("hc.answer.noSources")}</p>
        ) : (
          answer.body.map((p, i) => (
            <p key={i} className={i > 0 ? "mt-3" : undefined}>
              {p}
            </p>
          ))
        )}
        {answer.grounded ? (
          <p className="mt-4 flex items-center gap-2 text-sm text-ink-muted">
            <SparkleIcon width={15} height={15} className="text-brand" />
            {t("hc.aiGeneratedNote")}
          </p>
        ) : null}
      </AnswerBlock>
      <p className="mt-3 flex flex-wrap items-center gap-x-1.5 text-xs text-ink-muted">
        <span>{t("hc.savedLocalHint")}</span>
        <Link href="/login" className="text-brand hover:underline">
          {t("hc.savedAccountCta")}
        </Link>
      </p>
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

/** Speichern-Toggle für eine generierte Antwort (localStorage, local-first). */
function SaveToggle({ t, answer }: { t: T; answer: AskAnswer }) {
  const id = answerId(answer.question);
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    setSaved(isSaved(id));
  }, [id]);

  function toggle() {
    if (saved) {
      removeSaved(id);
      setSaved(false);
    } else {
      saveAnswer(answer);
      setSaved(true);
    }
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-pressed={saved}
      className={cn(
        "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition-colors",
        saved ? "border-brand text-brand" : "border-hairline text-ink-muted hover:text-ink",
      )}
    >
      {saved ? (
        <BookmarkCheckIcon width={15} height={15} />
      ) : (
        <BookmarkIcon width={15} height={15} />
      )}
      {saved ? t("hc.saved") : t("hc.save")}
    </button>
  );
}


/** Wartezustand der Generierung (Skeleton-artig, ohne Fake-Inhalte). */
function PendingAnswerView({ t, question }: { t: T; question: string }) {
  return (
    <div className="px-5 py-8 md:px-10">
      <div className="mx-auto max-w-3xl">
        <p className="text-xs uppercase tracking-[0.08em] text-ink-muted">{t("hc.answerHeading")}</p>
        <h1 className="mt-1.5 text-[26px] font-semibold leading-tight tracking-[-0.5px] [text-wrap:balance]">
          {question}
        </h1>
        <p className="mt-6 flex items-center gap-2 text-sm text-ink-muted">
          <SparkleIcon width={15} height={15} className="animate-pulse text-brand" />
          {t("hc.answer.loading")}
        </p>
      </div>
    </div>
  );
}

/** Fehlerzustand der Frage-Pipeline (frozen bzw. vorübergehend nicht verfügbar). */
function AskErrorView({
  t,
  code,
  onBack,
  onRetry,
}: {
  t: T;
  code: "frozen" | "unavailable";
  onBack: () => void;
  onRetry: () => void;
}) {
  return (
    <div className="mx-auto max-w-3xl">
      <BackButton t={t} onBack={onBack} />
      <p className="text-ink">{code === "frozen" ? t("hc.answer.frozen") : t("hc.answer.error")}</p>
      {code === "unavailable" ? (
        <button
          onClick={onRetry}
          className="mt-4 inline-flex items-center rounded-std border border-hairline px-3 py-1.5 text-sm text-ink transition-colors hover:bg-tint"
        >
          {t("hc.answer.retry")}
        </button>
      ) : null}
    </div>
  );
}
