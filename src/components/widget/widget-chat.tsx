"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { AskAnswer } from "@/lib/content/types";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { SupportTicketForm } from "@/components/help-center/support-ticket-form";
import { Button } from "@/components/ui/button";
import { FeedbackBar } from "@/components/ui/feedback-bar";
import { SendIcon, SparkleIcon, XIcon } from "@/components/ui/icons";

/**
 * WIDGET-CHAT (Bauphase Widget): die komplette Ask-Erfahrung in kompakt,
 * gerendert INNERHALB des Cross-Site-iframes (/widget). Besonderheiten
 * gegenüber dem Hilfezentrum:
 *  - Besucher-ID über `x-hoh-vid`-Header (Bootstrap /widget/session,
 *    partitionierter localStorage) — Third-Party-Cookies sind blockierbar.
 *  - Quellen-Links öffnen das Hilfezentrum in NEUEM Tab (target=_blank,
 *    Citation.slug), Roadmap/Changelog-Zitate werden nur gekennzeichnet.
 *  - Schließen-X + Brand-Farbe laufen per postMessage an den Loader
 *    (widget.js) im Eltern-Fenster.
 */

const VID_STORAGE_KEY = "hoh:widget:vid";

type View =
  | { kind: "idle" }
  | { kind: "loading"; question: string }
  | { kind: "answer"; answer: AskAnswer }
  | { kind: "error"; code: "unavailable" | "frozen" | "limited" | "network"; question: string };

export function WidgetChat({ locale, tenantName }: { locale: Locale; tenantName: string }) {
  const t = getT(locale);
  const [view, setView] = useState<View>({ kind: "idle" });
  const [input, setInput] = useState("");
  const vidRef = useRef<string | null>(null);

  // Bootstrap: signierte Besucher-ID holen/auffrischen + Loader informieren
  // (Brand-Farbe für den Launcher-Button; erst ab jetzt ist alles gestylt).
  useEffect(() => {
    void (async () => {
      try {
        const stored = localStorage.getItem(VID_STORAGE_KEY);
        const res = await fetch("/api/v1/widget/session", {
          headers: stored ? { "x-hoh-vid": stored } : {},
        });
        if (res.ok) {
          const { visitorId } = (await res.json()) as { visitorId: string };
          vidRef.current = visitorId;
          localStorage.setItem(VID_STORAGE_KEY, visitorId);
        }
      } catch {
        /* ohne ID weiter — Server vergibt dann pro Request */
      }
    })();
    const color = getComputedStyle(document.documentElement)
      .getPropertyValue("--brand-primary")
      .trim();
    window.parent?.postMessage({ type: "hoh:ready", color }, "*");
  }, []);

  function vidHeaders(): Record<string, string> {
    return vidRef.current ? { "x-hoh-vid": vidRef.current } : {};
  }

  async function ask(question: string) {
    const q = question.trim();
    if (q.length < 3) return;
    setView({ kind: "loading", question: q });
    setInput("");
    try {
      const res = await fetch("/api/v1/ask", {
        method: "POST",
        headers: { "content-type": "application/json", ...vidHeaders() },
        body: JSON.stringify({ question: q }),
      });
      if (res.ok) {
        setView({ kind: "answer", answer: (await res.json()) as AskAnswer });
        return;
      }
      setView({
        kind: "error",
        code: res.status === 402 ? "frozen" : res.status === 429 ? "limited" : "unavailable",
        question: q,
      });
    } catch {
      setView({ kind: "error", code: "network", question: q });
    }
  }

  function submit(e: FormEvent) {
    e.preventDefault();
    void ask(input);
  }

  function sendWidgetFeedback(helpful: boolean) {
    void fetch("/api/v1/events/feedback", {
      method: "POST",
      headers: { "content-type": "application/json", ...vidHeaders() },
      body: JSON.stringify({ helpful }),
      keepalive: true,
    }).catch(() => {});
  }

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      <header className="flex items-center justify-between gap-2 border-b border-hairline bg-surface px-4 py-3">
        <div className="flex min-w-0 items-center gap-2">
          <SparkleIcon width={16} height={16} className="shrink-0 text-brand" />
          <p className="truncate text-sm font-semibold">
            {t("widget.title", { name: tenantName })}
          </p>
        </div>
        <button
          type="button"
          aria-label={t("widget.close")}
          onClick={() => window.parent?.postMessage({ type: "hoh:close" }, "*")}
          className="rounded-full p-1.5 text-ink-muted transition-colors hover:bg-tint hover:text-ink"
        >
          <XIcon width={16} height={16} />
        </button>
      </header>

      <main className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
        {view.kind === "idle" ? (
          <p className="py-6 text-center text-sm text-ink-muted">{t("widget.intro")}</p>
        ) : view.kind === "loading" ? (
          <div>
            <p className="text-sm font-semibold">{view.question}</p>
            <p className="mt-3 flex items-center gap-2 text-sm text-ink-muted">
              <SparkleIcon width={15} height={15} className="animate-pulse text-brand" />
              {t("hc.answer.loading")}
            </p>
          </div>
        ) : view.kind === "error" ? (
          <div>
            <p className="text-sm font-semibold">{view.question}</p>
            <p className="mt-3 text-sm text-ink-muted">
              {view.code === "frozen"
                ? t("hc.answer.frozen")
                : view.code === "limited"
                  ? t("security.rateLimited")
                  : t("hc.answer.error")}
            </p>
            <Button size="sm" className="mt-3" onClick={() => void ask(view.question)}>
              {t("hc.answer.retry")}
            </Button>
          </div>
        ) : (
          <WidgetAnswer
            t={t}
            locale={locale}
            answer={view.answer}
            onFeedback={sendWidgetFeedback}
          />
        )}
      </main>

      <form
        onSubmit={submit}
        className="flex items-center gap-2 border-t border-hairline bg-surface px-3 py-3"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={t("widget.placeholder")}
          aria-label={t("widget.placeholder")}
          maxLength={400}
          className="min-w-0 flex-1 rounded-full border border-hairline bg-surface-raised px-4 py-2 text-sm text-ink placeholder:text-ink-muted/70 focus:outline-none focus:ring-2 focus:ring-brand/40"
        />
        <button
          type="submit"
          aria-label={t("widget.send")}
          disabled={view.kind === "loading" || input.trim().length < 3}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand text-brand-fg transition-opacity disabled:opacity-40"
        >
          <SendIcon width={15} height={15} />
        </button>
      </form>
    </div>
  );
}

function WidgetAnswer({
  t,
  locale,
  answer,
  onFeedback,
}: {
  t: ReturnType<typeof getT>;
  locale: Locale;
  answer: AskAnswer;
  onFeedback: (helpful: boolean) => void;
}) {
  const articleLinks = answer.citations.filter(
    (c) => (c.kind ?? "article") === "article" && c.slug,
  );

  return (
    <div>
      <p className="text-sm font-semibold">{answer.question}</p>

      {answer.grounded && answer.body.length > 0 ? (
        <div className="mt-3 text-sm leading-relaxed">
          {answer.body.map((p, i) => (
            <p key={i} className={i > 0 ? "mt-2.5" : undefined}>
              {p}
            </p>
          ))}
          <p className="mt-3 flex items-center gap-1.5 text-xs text-ink-muted">
            <SparkleIcon width={13} height={13} className="text-brand" />
            {t("hc.aiGeneratedNote")}
          </p>
        </div>
      ) : (
        <p className="mt-3 text-sm text-ink-muted">{t("hc.answer.noSources")}</p>
      )}

      {articleLinks.length > 0 ? (
        <div className="mt-4">
          <p className="mb-1.5 text-xs uppercase tracking-[0.08em] text-ink-muted">
            {t("hc.sourcesHeading")}
          </p>
          <ul className="flex flex-col gap-1.5">
            {articleLinks.map((c) => (
              <li key={c.id}>
                {/* Neuer Tab: das Widget lebt im iframe der Kunden-Seite. */}
                <a
                  href={`/${c.slug}`}
                  target="_blank"
                  rel="noreferrer"
                  className="text-sm text-brand underline-offset-2 hover:underline"
                >
                  {c.title} ↗
                </a>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-5">
        <FeedbackBar
          labels={{
            question: t("hc.feedbackQuestion"),
            yes: t("hc.feedbackYes"),
            no: t("hc.feedbackNo"),
            thanks: t("hc.feedbackThanks"),
          }}
          onVote={(v) => onFeedback(v === "up")}
        />
      </div>
      <div className="mt-3">
        <SupportTicketForm locale={locale} question={answer.question} />
      </div>
    </div>
  );
}
