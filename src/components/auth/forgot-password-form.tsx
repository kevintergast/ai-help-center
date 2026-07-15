"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { getT } from "@/i18n/t";
import type { Locale } from "@/lib/tenant/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { requestPasswordReset } from "@/lib/auth-client";
import { validateEmail } from "@/lib/auth/validate";
import { TurnstileWidget } from "@/components/security/turnstile-widget";
import { ErrorNote, PendingNote } from "./notes";

/**
 * Passwort-vergessen (Anforderung). Antwortet IMMER mit derselben generischen
 * Bestätigung — unabhängig davon, ob ein Konto existiert (keine
 * Account-Enumeration). Der Reset-Link in der Mail landet auf /reset-password.
 */
export function ForgotPasswordForm({
  locale,
  turnstileSiteKey = null,
}: {
  locale: Locale;
  /** Turnstile-Site-Key (public); `null` = Umgebung ohne Bot-Schutz (dev). */
  turnstileSiteKey?: string | null;
}) {
  const t = getT(locale);
  const [email, setEmail] = useState("");
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const emailError = validateEmail(email);
    if (emailError) return setError(t(emailError));

    setBusy(true);
    // Fehler des Backends werden bewusst NICHT unterschieden angezeigt (kein
    // Orakel); nur ein echter Transportfehler bleibt unbestätigt.
    await requestPasswordReset({
      email,
      redirectTo: "/reset-password",
      turnstileToken,
    }).catch(() => {});
    setBusy(false);
    setSent(true);
  }

  if (sent) {
    return (
      <div className="flex flex-col gap-5">
        <PendingNote tone="ok">{t("auth.forgot.sent")}</PendingNote>
        <Link href="/login" className="text-center text-sm text-brand hover:underline">
          {t("auth.forgot.backToLogin")}
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <Input
        label={t("auth.email")}
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder={t("auth.emailPlaceholder")}
        autoComplete="email"
        required
      />
      {turnstileSiteKey ? (
        <TurnstileWidget siteKey={turnstileSiteKey} onToken={setTurnstileToken} language={locale} />
      ) : null}
      <ErrorNote>{error || null}</ErrorNote>
      <Button
        type="submit"
        disabled={busy || (turnstileSiteKey !== null && turnstileToken === null)}
        className="w-full justify-center"
      >
        {busy ? t("auth.submitting") : t("auth.forgot.submit")}
      </Button>
    </form>
  );
}
