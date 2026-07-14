"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { getT } from "@/i18n/t";
import type { Locale } from "@/lib/tenant/types";
import { Button } from "@/components/ui/button";
import { resetPassword } from "@/lib/auth-client";
import { mapAuthError } from "@/lib/auth/errors";
import { validatePasswordConfirm } from "@/lib/auth/validate";
import { PasswordField } from "./password-field";
import { ErrorNote, PendingNote } from "./notes";

/**
 * Neues Passwort setzen (Token aus dem Reset-Link). Ohne Token → Hinweis, einen
 * neuen anzufordern (fail-closed). Nach Erfolg: Erfolgsmeldung + Link zur
 * Anmeldung (better-auth widerruft dabei serverseitig andere Sessions).
 */
export function ResetPasswordForm({ locale, token }: { locale: Locale; token: string | null }) {
  const t = getT(locale);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!token) {
    return (
      <div className="flex flex-col gap-5">
        <ErrorNote>{t("auth.reset.missingToken")}</ErrorNote>
        <Link href="/forgot-password" className="text-center text-sm text-brand hover:underline">
          {t("auth.forgot.title")}
        </Link>
      </div>
    );
  }

  if (done) {
    return (
      <div className="flex flex-col gap-5">
        <PendingNote tone="ok">{t("auth.reset.success")}</PendingNote>
        <Link href="/login" className="text-center text-sm text-brand hover:underline">
          {t("auth.forgot.backToLogin")}
        </Link>
      </div>
    );
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const pwError = validatePasswordConfirm(password, confirm);
    if (pwError) return setError(t(pwError));

    setBusy(true);
    const { error: err } = await resetPassword({ newPassword: password, token: token! });
    if (err) {
      setBusy(false);
      setError(t(mapAuthError(err, "reset")));
      return;
    }
    setDone(true);
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <PasswordField
        locale={locale}
        label={t("auth.reset.newPassword")}
        value={password}
        onChange={(e) => setPassword(e.target.value)}
        autoComplete="new-password"
        required
      />
      <PasswordField
        locale={locale}
        label={t("auth.reset.confirmPassword")}
        value={confirm}
        onChange={(e) => setConfirm(e.target.value)}
        autoComplete="new-password"
        required
      />
      <p className="-mt-1 text-xs text-ink-muted">{t("auth.passwordHint")}</p>
      <ErrorNote>{error || null}</ErrorNote>
      <Button type="submit" disabled={busy} className="w-full justify-center">
        {busy ? t("auth.submitting") : t("auth.reset.submit")}
      </Button>
    </form>
  );
}
