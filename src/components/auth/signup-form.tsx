"use client";

import { useState, type FormEvent } from "react";
import { getT } from "@/i18n/t";
import type { Locale } from "@/lib/tenant/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signUpEmail } from "@/lib/auth-client";
import { mapAuthError } from "@/lib/auth/errors";
import { validateEmail, validateName, validatePassword } from "@/lib/auth/validate";
import { PasswordField } from "./password-field";
import { SocialButtons } from "./social-buttons";
import { ErrorNote } from "./notes";

type Provider = "google" | "microsoft";

/** Landing nach Klick auf den Verifizierungslink aus der E-Mail. */
const VERIFY_CALLBACK = "/login?verified=1";

/**
 * Registrierungs-Formular (Punkt 4a): Name + E-Mail + Passwort und Social. Da
 * `requireEmailVerification` aktiv ist, wird KEINE Session erstellt; nach dem
 * Anlegen leiten wir auf /verify-email (Hinweis „E-Mail bestätigen").
 */
export function SignupForm({
  locale,
  socialProviders,
}: {
  locale: Locale;
  socialProviders: Provider[];
}) {
  const t = getT(locale);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    const nameError = validateName(name);
    if (nameError) return setError(t(nameError));
    const emailError = validateEmail(email);
    if (emailError) return setError(t(emailError));
    const pwError = validatePassword(password);
    if (pwError) return setError(t(pwError));

    setBusy(true);
    const { error: err } = await signUpEmail({
      name: name.trim(),
      email,
      password,
      callbackURL: VERIFY_CALLBACK,
    });
    if (err) {
      setBusy(false);
      setError(t(mapAuthError(err, "signUp")));
      return;
    }
    window.location.assign(`/verify-email?email=${encodeURIComponent(email)}`);
  }

  return (
    <div className="flex flex-col gap-5">
      <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
        <Input
          label={t("auth.name")}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("auth.namePlaceholder")}
          autoComplete="name"
          required
        />
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
          autoComplete="new-password"
          required
        />
        <p className="-mt-1 text-xs text-ink-muted">{t("auth.passwordHint")}</p>

        <ErrorNote>{error || null}</ErrorNote>

        <Button type="submit" disabled={busy} className="w-full justify-center">
          {busy ? t("auth.submitting") : t("auth.signup.submit")}
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
            errorCallbackURL="/signup?error=social"
            onError={setError}
          />
        </>
      ) : null}
    </div>
  );
}
