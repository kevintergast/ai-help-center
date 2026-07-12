"use client";

import { useState } from "react";
import { getT } from "@/i18n/t";
import type { Locale } from "@/lib/tenant/types";
import { Button } from "@/components/ui/button";
import { resendVerificationEmail } from "@/lib/auth-client";
import { mapAuthError } from "@/lib/auth/errors";
import { ErrorNote, PendingNote } from "./notes";

/**
 * „Bitte E-Mail bestätigen"-Zustand + erneut senden. Die E-Mail-Adresse kommt
 * per Query (nach Registrierung/Login-mit-unbestätigter-Mail). Der Klick auf den
 * Link in der Mail wird serverseitig von better-auth verifiziert und landet auf
 * /login?verified=1 (dort erscheint die Erfolgsmeldung).
 */
export function VerifyEmailPanel({ locale, email }: { locale: Locale; email: string | null }) {
  const t = getT(locale);
  const [error, setError] = useState("");
  const [resent, setResent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function resend() {
    if (!email) return;
    setBusy(true);
    setError("");
    const { error: err } = await resendVerificationEmail({
      email,
      callbackURL: "/login?verified=1",
    });
    setBusy(false);
    if (err) {
      setError(t(mapAuthError(err, "generic")));
      return;
    }
    setResent(true);
  }

  return (
    <div className="flex flex-col gap-5">
      <PendingNote tone="info">
        {email ? t("auth.verify.body", { email }) : t("auth.verify.bodyNoEmail")}
      </PendingNote>

      {resent ? <PendingNote tone="ok">{t("auth.verify.resent")}</PendingNote> : null}
      <ErrorNote>{error || null}</ErrorNote>

      {email ? (
        <Button type="button" variant="cream" onClick={resend} disabled={busy} className="w-full justify-center">
          {busy ? t("auth.submitting") : t("auth.verify.resend")}
        </Button>
      ) : null}

      <a href="/login" className="text-center text-sm text-brand hover:underline">
        {t("auth.verify.toLogin")}
      </a>
    </div>
  );
}
