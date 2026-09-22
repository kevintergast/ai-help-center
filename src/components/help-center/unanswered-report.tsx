"use client";

import { useState, type FormEvent } from "react";
import type { Locale } from "@/lib/tenant/types";
import { getT } from "@/i18n/t";
import { Button } from "@/components/ui/button";
import { HelpCircleIcon } from "@/components/ui/icons";

/**
 * „ICH BRAUCHE DAZU EINE ANTWORT" (0047) — das Angebot unter einer
 * Nicht-Antwort.
 *
 * WARUM: Bisher endete die Nicht-Antwort mit „Formuliere die Frage anders —
 * oder stöbere links in den Artikeln." Das schickt den Nutzer zurück ins
 * Blättern und verliert genau die Information, die der Redaktion fehlt.
 * Jetzt kann er sagen, dass er darauf wartet — und die Frage landet in der
 * Warteschlange im Verwaltungsbereich.
 *
 * ABGRENZUNG zum Support-Formular darunter: Das hier meldet eine LÜCKE IM
 * INHALT („dazu fehlt ein Artikel"), das andere einen Support-Fall („etwas
 * stimmt nicht"). Zwei verschiedene Anliegen, deshalb zwei Wege — und
 * deshalb steht dieser hier oben und sichtbar, nicht als Aufklapper.
 *
 * Die Adresse ist FREIWILLIG: Die Meldung ist auch anonym wertvoll, und eine
 * Pflichtangabe würde genau die Fälle verlieren, in denen jemand nur schnell
 * Bescheid geben will.
 */
export function UnansweredReport({ locale, question }: { locale: Locale; question: string }) {
  const t = getT(locale);
  const [phase, setPhase] = useState<"idle" | "open" | "sending" | "sent">("idle");
  const [email, setEmail] = useState("");
  const [error, setError] = useState<"email" | "failed" | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setPhase("sending");
    setError(null);
    try {
      const res = await fetch("/api/v1/unanswered/report", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question, email: email.trim() || undefined }),
      });
      if (res.ok) {
        setPhase("sent");
        return;
      }
      const data = (await res.json().catch(() => null)) as { error?: string } | null;
      setError(data?.error === "invalid_email" ? "email" : "failed");
      setPhase("open");
    } catch {
      setError("failed");
      setPhase("open");
    }
  }

  if (phase === "sent") {
    return (
      <p className="mt-4 rounded-comfy border border-hairline bg-tint px-4 py-3 text-sm text-ink">
        {t("hc.unanswered.thanks")}
      </p>
    );
  }

  if (phase === "idle") {
    return (
      <Button className="mt-4" onClick={() => setPhase("open")}>
        <HelpCircleIcon width={16} height={16} />
        {t("hc.unanswered.cta")}
      </Button>
    );
  }

  return (
    <form
      onSubmit={submit}
      className="mt-4 rounded-comfy border border-hairline bg-surface-raised p-4"
    >
      <p className="text-sm text-ink">{t("hc.unanswered.formTitle")}</p>
      <label className="mt-3 block text-xs text-ink-muted" htmlFor="unanswered-email">
        {t("hc.unanswered.emailLabel")}
      </label>
      <input
        id="unanswered-email"
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("hc.unanswered.emailPlaceholder")}
        className="mt-1 w-full rounded-std border border-hairline bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-muted focus-visible:outline-none focus-visible:shadow-focusglow"
      />
      {error ? (
        <p className="mt-2 text-xs text-crit" role="alert">
          {t(error === "email" ? "hc.unanswered.error.email" : "hc.unanswered.error.failed")}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="submit" disabled={phase === "sending"}>
          {t("hc.unanswered.send")}
        </Button>
        <Button type="button" variant="ghost" onClick={() => setPhase("idle")}>
          {t("hc.unanswered.cancel")}
        </Button>
      </div>
    </form>
  );
}
