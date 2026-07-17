"use client";

import { useState, type FormEvent } from "react";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/ui/cn";

/**
 * „ETWAS STIMMT NICHT?" (Support-Flow, Richtung Endnutzer → Tenant):
 * dezenter Trigger unter der KI-Antwort → Inline-Formular → POST
 * /api/v1/support/tickets (public, rate-limitiert). Die KI-Antwort davor IST
 * die Triage: Inhaltsfragen sind beantwortet bzw. ehrlich verneint — hier
 * eskaliert der echte Support-/Technikfall. `question` reist als Kontext mit.
 */
export function SupportTicketForm({
  locale,
  question,
  className,
}: {
  locale: Locale;
  question: string | null;
  className?: string;
}) {
  const t = getT(locale);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [email, setEmail] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "done" | "invalid" | "limited" | "error">(
    "idle",
  );

  if (state === "done") {
    return (
      <p className={cn("text-sm text-ok", className)} role="status">
        {t("hc.support.done")}
      </p>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={cn("text-sm text-ink-muted underline-offset-2 hover:text-ink hover:underline", className)}
      >
        {t("hc.support.trigger")}
      </button>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (message.trim().length < 10) {
      setState("invalid");
      return;
    }
    setState("sending");
    try {
      const res = await fetch("/api/v1/support/tickets", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          message: message.trim(),
          ...(email.trim() ? { contactEmail: email.trim() } : {}),
          ...(question ? { question } : {}),
        }),
      });
      if (res.status === 201) {
        setState("done");
        return;
      }
      setState(res.status === 429 ? "limited" : res.status === 400 ? "invalid" : "error");
    } catch {
      setState("error");
    }
  }

  return (
    <form
      onSubmit={submit}
      className={cn("flex flex-col gap-3 rounded-comfy border border-hairline bg-surface p-4", className)}
    >
      <p className="text-sm font-medium text-ink">{t("hc.support.title")}</p>
      <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
        {t("hc.support.messageLabel")}
        <textarea
          value={message}
          onChange={(e) => {
            setMessage(e.target.value);
            if (state === "invalid") setState("idle");
          }}
          rows={4}
          maxLength={2000}
          placeholder={t("hc.support.messagePlaceholder")}
          className="w-full resize-y rounded-std border border-hairline bg-surface-raised px-3 py-2 text-base text-ink placeholder:text-ink-muted/70"
        />
      </label>
      <label className="flex flex-col gap-1.5 text-sm text-ink-muted">
        {t("hc.support.emailLabel")}
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder={t("hc.support.emailPlaceholder")}
          className="w-full max-w-sm rounded-std border border-hairline bg-surface-raised px-3 py-2 text-base text-ink placeholder:text-ink-muted/70"
        />
      </label>
      <div className="flex flex-wrap items-center gap-3">
        <Button type="submit" disabled={state === "sending"}>
          {state === "sending" ? t("hc.support.submitting") : t("hc.support.submit")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setOpen(false)}>
          {t("hc.support.cancel")}
        </Button>
        <span aria-live="polite" className="text-xs">
          {state === "invalid" ? (
            <span className="text-crit">{t("hc.support.tooShort")}</span>
          ) : state === "limited" ? (
            <span className="text-warn">{t("security.rateLimited")}</span>
          ) : state === "error" ? (
            <span className="text-crit">{t("hc.support.error")}</span>
          ) : null}
        </span>
      </div>
    </form>
  );
}
