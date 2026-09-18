"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import {
  MAX_COMPREHENSION_MESSAGE,
  MIN_COMPREHENSION_MESSAGE,
} from "@/lib/content/comprehension";
import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { HelpCircleIcon, CloseIcon } from "@/components/ui/icons";
import { cn } from "@/lib/ui/cn";

/**
 * „ICH VERSTEHE ETWAS NICHT" (0039) — ein MODUS, kein Formular.
 *
 * WARUM EIN MODUS: Der Hinweis soll an der Stelle hängen, die unklar ist.
 * Ein Formular am Artikelende bekäme „irgendwo in der Mitte war etwas
 * seltsam" — damit kann niemand arbeiten. Erst durch das Anklicken der Stelle
 * wird der Hinweis für die Redaktion verwertbar.
 *
 * ABLAUF: Knopf → Erklärung (Weiter/Abbrechen) → Blöcke werden anklickbar,
 * der Zeiger wird zum Fadenkreuz → Klick öffnet den Kommentar → zweiter,
 * FREIWILLIGER Schritt für die Rückmelde-Adresse.
 *
 * Die Erklärung vorweg ist kein Zierrat: Ohne sie klickt jemand den Knopf,
 * die Seite verhält sich plötzlich anders, und er weiß nicht, warum.
 */

type Phase = "off" | "explain" | "picking" | "comment" | "email" | "sent";

export function ComprehensionMode({
  locale,
  articleId,
  className,
}: {
  locale: Locale;
  articleId: string;
  className?: string;
}) {
  const t = getT(locale);
  const [phase, setPhase] = useState<Phase>("off");
  const [anchor, setAnchor] = useState<number | null>(null);
  const [quote, setQuote] = useState("");
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<"short" | "email" | "failed" | null>(null);
  const [sending, setSending] = useState(false);
  const active = phase === "picking";
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  /**
   * Der Auswahl-Modus lebt am `<body>`: Die anklickbaren Blöcke stehen in
   * einem ganz anderen Teilbaum (der Artikel-Renderer), und ein Zustand, den
   * beide sehen, ist hier ein Klassenname — kein weiterer Kontext, der durch
   * fünf Ebenen gereicht werden müsste.
   */
  useEffect(() => {
    if (!active) return;
    document.body.classList.add("hoh-picking");
    const onClick = (e: MouseEvent) => {
      const target = (e.target as HTMLElement | null)?.closest("[data-block]");
      if (!(target instanceof HTMLElement)) return;
      e.preventDefault();
      e.stopPropagation();
      const index = Number(target.dataset.block);
      if (!Number.isInteger(index)) return;
      setAnchor(index);
      setQuote((target.innerText ?? "").replace(/\s+/g, " ").trim().slice(0, 300));
      setPhase("comment");
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPhase("off");
    };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey);
    return () => {
      document.body.classList.remove("hoh-picking");
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("keydown", onKey);
    };
  }, [active]);

  useEffect(() => {
    if (phase === "comment") textareaRef.current?.focus();
  }, [phase]);

  /**
   * Ein `<dialog>` feuert `close` AUCH, wenn wir es selbst schließen — also
   * bei jedem Schritt weiter. Ein unbedingtes `reset()` am `onClose` hätte
   * darum jeden Fortschritt sofort zurückgenommen (Live-Fund 2026-09-18:
   * „Weiter" setzte den Modus, das Schließen des Dialogs beendete ihn wieder).
   *
   * Deshalb wirkt das Abbrechen nur, wenn die Phase NOCH die des Dialogs ist:
   * Hat sie sich schon weiterbewegt, kam das Schließen von uns.
   */
  const dismiss = (from: Phase, to: Phase = "off") => () =>
    setPhase((p) => (p === from ? to : p));

  function reset() {
    setPhase("off");
    setAnchor(null);
    setQuote("");
    setMessage("");
    setEmail("");
    setError(null);
  }

  async function submit(withEmail: boolean) {
    if (message.trim().length < MIN_COMPREHENSION_MESSAGE) {
      setError("short");
      return;
    }
    setSending(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/support/comprehension", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          articleId,
          anchor,
          quote,
          message: message.trim(),
          email: withEmail ? email.trim() : "",
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => ({}))) as { error?: string };
        setError(body.error === "invalid_email" ? "email" : "failed");
        return;
      }
      setPhase("sent");
    } catch {
      setError("failed");
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => (phase === "off" ? setPhase("explain") : reset())}
        aria-pressed={active}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-std px-2.5 py-1.5 text-sm transition-colors",
          active
            ? "bg-brand text-brand-fg"
            : "text-ink-muted hover:bg-tint hover:text-ink",
          className,
        )}
      >
        {active ? <CloseIcon width={15} height={15} /> : <HelpCircleIcon width={15} height={15} />}
        {active ? t("hc.comprehension.stop") : t("hc.comprehension.start")}
      </button>

      {/* Schritt 1: erklären, bevor sich die Seite anders verhält. */}
      <Dialog open={phase === "explain"} onClose={dismiss("explain")} closeLabel={t("hc.comprehension.dialogClose")} title={t("hc.comprehension.explainTitle")}>
        <p className="text-sm text-ink-muted">{t("hc.comprehension.explainBody")}</p>
        <div className="mt-4 flex items-center gap-2">
          <Button onClick={() => setPhase("picking")}>{t("hc.comprehension.continue")}</Button>
          <Button variant="ghost" onClick={reset}>
            {t("hc.comprehension.cancel")}
          </Button>
        </div>
      </Dialog>

      {/* Schritt 2: der Kommentar zur angeklickten Stelle. */}
      <Dialog
        open={phase === "comment"}
        onClose={dismiss("comment", "picking")}
        closeLabel={t("hc.comprehension.dialogClose")}
        title={t("hc.comprehension.commentTitle")}
      >
        {quote.length > 0 ? (
          <p className="mb-3 border-l-2 border-hairline-strong pl-3 text-sm italic text-ink-muted">
            {quote.length > 160 ? `${quote.slice(0, 160)}…` : quote}
          </p>
        ) : null}
        <form
          onSubmit={(e: FormEvent) => {
            e.preventDefault();
            setError(null);
            setPhase("email");
          }}
        >
          <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
            {t("hc.comprehension.commentLabel")}
            <textarea
              ref={textareaRef}
              value={message}
              onChange={(e) => {
                setMessage(e.target.value);
                setError(null);
              }}
              rows={4}
              maxLength={MAX_COMPREHENSION_MESSAGE}
              placeholder={t("hc.comprehension.commentPlaceholder")}
              className="w-full rounded-comfy border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink outline-none focus:border-transparent focus:shadow-[0_0_0_2px_var(--ring)]"
            />
          </label>
          <div className="mt-4 flex items-center gap-2">
            <Button type="submit" disabled={message.trim().length < MIN_COMPREHENSION_MESSAGE}>
              {t("hc.comprehension.continue")}
            </Button>
            <Button type="button" variant="ghost" onClick={() => setPhase("picking")}>
              {t("hc.comprehension.back")}
            </Button>
          </div>
        </form>
      </Dialog>

      {/* Schritt 3: FREIWILLIG. „Ohne Adresse senden" steht gleichwertig
          daneben, nicht als kleiner Verzicht-Link darunter. */}
      <Dialog open={phase === "email"} onClose={dismiss("email")} closeLabel={t("hc.comprehension.dialogClose")} title={t("hc.comprehension.emailTitle")}>
        <p className="text-sm text-ink-muted">{t("hc.comprehension.emailBody")}</p>
        <input
          type="email"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            setError(null);
          }}
          placeholder={t("hc.comprehension.emailPlaceholder")}
          className="mt-3 w-full rounded-comfy border border-hairline bg-surface-raised px-3 py-2 text-sm text-ink outline-none focus:border-transparent focus:shadow-[0_0_0_2px_var(--ring)]"
        />
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Button onClick={() => void submit(true)} disabled={sending || email.trim().length === 0}>
            {t("hc.comprehension.send")}
          </Button>
          <Button variant="ghost" onClick={() => void submit(false)} disabled={sending}>
            {t("hc.comprehension.sendAnonymous")}
          </Button>
        </div>
        {error ? (
          <p className="mt-2 text-xs text-crit" role="alert">
            {error === "email"
              ? t("hc.comprehension.error.email")
              : error === "short"
                ? t("hc.comprehension.error.short")
                : t("hc.comprehension.error.failed")}
          </p>
        ) : null}
      </Dialog>

      <Dialog open={phase === "sent"} onClose={dismiss("sent")} closeLabel={t("hc.comprehension.dialogClose")} title={t("hc.comprehension.sentTitle")}>
        <p className="text-sm text-ink-muted">{t("hc.comprehension.sentBody")}</p>
        <div className="mt-4">
          <Button onClick={reset}>{t("hc.comprehension.close")}</Button>
        </div>
      </Dialog>
    </>
  );
}
