"use client";

import { useState, type FormEvent } from "react";
import { getT } from "@/i18n/t";
import type { Locale } from "@/lib/tenant/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signInEmail, getSessionRole } from "@/lib/auth-client";
import { mapAuthError } from "@/lib/auth/errors";
import { resolvePostLoginRedirect } from "@/lib/auth/redirect";
import { validateEmail, validatePassword } from "@/lib/auth/validate";
import { PasswordField } from "./password-field";
import { SocialButtons } from "./social-buttons";
import { ErrorNote, PendingNote } from "./notes";
import { TwoFactorChallenge } from "./two-factor-challenge";

type Provider = "google" | "microsoft";

/**
 * Anmelde-Formular (Punkt 4a): E-Mail+Passwort, Social (nur verfügbare
 * Provider), Inline-2FA bei `twoFactorRedirect`, Links zu Registrierung/
 * Passwort-vergessen. Nach Erfolg Redirect gemäß Rolle (Team → /admin, sonst
 * Startseite) bzw. ein sicherer `?redirect`-Wunsch. Fehler nutzerfreundlich und
 * ohne Account-Enumeration; „E-Mail nicht bestätigt" führt zur Verify-Seite.
 */
export function LoginForm({
  locale,
  socialProviders,
  requestedRedirect,
  verified,
  socialError,
}: {
  locale: Locale;
  socialProviders: Provider[];
  requestedRedirect: string | null;
  verified?: boolean;
  socialError?: boolean;
}) {
  const t = getT(locale);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState(socialError ? t("auth.error.generic") : "");
  const [busy, setBusy] = useState(false);
  const [phase, setPhase] = useState<"credentials" | "twofa">("credentials");
  const [methods, setMethods] = useState<string[] | undefined>(undefined);

  async function finish() {
    const role = await getSessionRole();
    window.location.assign(resolvePostLoginRedirect({ role, requested: requestedRedirect }));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const emailError = validateEmail(email);
    if (emailError) return setError(t(emailError));
    const pwError = validatePassword(password);
    if (pwError) return setError(t(pwError));

    setBusy(true);
    const { data, error: err } = await signInEmail({ email, password });
    if (err) {
      setBusy(false);
      if (err.code === "EMAIL_NOT_VERIFIED") {
        window.location.assign(`/verify-email?email=${encodeURIComponent(email)}`);
        return;
      }
      setError(t(mapAuthError(err, "signIn")));
      return;
    }
    if ((data as { twoFactorRedirect?: boolean } | null)?.twoFactorRedirect) {
      setMethods((data as { twoFactorMethods?: string[] }).twoFactorMethods);
      setPhase("twofa");
      setBusy(false);
      return;
    }
    await finish();
  }

  if (phase === "twofa") {
    return <TwoFactorChallenge locale={locale} methods={methods} onVerified={finish} />;
  }

  return (
    <div className="flex flex-col gap-5">
      {verified ? <PendingNote tone="ok">{t("auth.verify.successBody")}</PendingNote> : null}

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
        <PasswordField
          locale={locale}
          label={t("auth.password")}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete="current-password"
          required
        />
        <div className="-mt-1 text-right text-sm">
          <a href="/forgot-password" className="text-brand hover:underline">
            {t("auth.login.forgot")}
          </a>
        </div>

        <ErrorNote>{error || null}</ErrorNote>

        <Button type="submit" disabled={busy} className="w-full justify-center">
          {busy ? t("auth.submitting") : t("auth.login.submit")}
        </Button>
      </form>

      {socialProviders.length > 0 ? (
        <>
          <div className="flex items-center gap-3 text-xs text-ink-muted">
            <span className="h-px flex-1 bg-hairline" />
            {t("auth.or")}
            <span className="h-px flex-1 bg-hairline" />
          </div>
          <SocialButtons
            providers={socialProviders}
            locale={locale}
            callbackURL="/"
            errorCallbackURL="/login?error=social"
            onError={setError}
          />
        </>
      ) : null}
    </div>
  );
}
