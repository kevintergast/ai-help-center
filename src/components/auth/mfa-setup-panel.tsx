"use client";

import { useState, type FormEvent } from "react";
import { getT } from "@/i18n/t";
import type { Locale } from "@/lib/tenant/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { twoFactor, getSessionRole } from "@/lib/auth-client";
import { mapAuthError } from "@/lib/auth/errors";
import { resolvePostLoginRedirect } from "@/lib/auth/redirect";
import { validateOtpCode } from "@/lib/auth/validate";
import { PasswordField } from "./password-field";
import { ErrorNote, PendingNote } from "./notes";

type Step = "start" | "verify" | "done";

/** Liest den `secret`-Parameter (manuelle Eingabe) aus einer otpauth-URI. */
function secretFromOtpauth(uri: string): string | null {
  try {
    return new URL(uri).searchParams.get("secret");
  } catch {
    return null;
  }
}

/**
 * TOTP-ENROLLMENT (Punkt 4a): Passwort bestätigen → `enable` (liefert
 * otpauth-URI + Backup-Codes) → Code verifizieren → Backup-Codes anzeigen.
 * Erst der erfolgreiche verify flippt `twoFactorEnabled` (auth.ts:
 * skipVerificationOnEnable=false). Team-Rollen (Admin/Owner) benötigen TOTP —
 * Hinweis steht oben. Social-only-Konten ohne Passwort lassen das Feld leer
 * (allowPasswordless).
 */
export function MfaSetupPanel({ locale }: { locale: Locale }) {
  const t = getT(locale);
  const [step, setStep] = useState<Step>("start");
  const [password, setPassword] = useState("");
  const [otpauth, setOtpauth] = useState<string | null>(null);
  const [backupCodes, setBackupCodes] = useState<string[]>([]);
  const [code, setCode] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const secret = otpauth ? secretFromOtpauth(otpauth) : null;

  async function start(e: FormEvent) {
    e.preventDefault();
    setError("");
    setBusy(true);
    const { data, error: err } = await twoFactor.enable(
      password ? { password } : ({} as { password: string }),
    );
    if (err) {
      setBusy(false);
      setError(t(mapAuthError(err, "generic")));
      return;
    }
    const payload = data as { totpURI?: string; backupCodes?: string[] } | null;
    setOtpauth(payload?.totpURI ?? null);
    setBackupCodes(payload?.backupCodes ?? []);
    setBusy(false);
    setStep("verify");
  }

  async function verify(e: FormEvent) {
    e.preventDefault();
    setError("");
    const codeError = validateOtpCode(code);
    if (codeError) return setError(t(codeError));
    setBusy(true);
    const { error: err } = await twoFactor.verifyTotp({ code });
    if (err) {
      setBusy(false);
      setError(t(mapAuthError(err, "twoFactor")));
      return;
    }
    setBusy(false);
    setStep("done");
  }

  async function finish() {
    const role = await getSessionRole();
    window.location.assign(resolvePostLoginRedirect({ role, requested: null }));
  }

  return (
    <div className="flex flex-col gap-5">
      <PendingNote tone="info">{t("auth.mfa.teamNote")}</PendingNote>

      {step === "start" ? (
        <form onSubmit={start} className="flex flex-col gap-4" noValidate>
          <p className="text-sm text-ink-muted">{t("auth.mfa.passwordPrompt")}</p>
          <PasswordField
            locale={locale}
            label={t("auth.password")}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
          />
          <ErrorNote>{error || null}</ErrorNote>
          <Button type="submit" disabled={busy} className="w-full justify-center">
            {busy ? t("auth.submitting") : t("auth.mfa.start")}
          </Button>
        </form>
      ) : null}

      {step === "verify" ? (
        <form onSubmit={verify} className="flex flex-col gap-4" noValidate>
          <div className="flex flex-col gap-2 rounded-std border border-hairline bg-surface-raised p-4">
            <strong className="text-sm font-semibold text-ink">{t("auth.mfa.scanTitle")}</strong>
            <p className="text-sm text-ink-muted">{t("auth.mfa.scanBody")}</p>
            {secret ? (
              <>
                <span className="text-xs text-ink-muted">{t("auth.mfa.manualKey")}</span>
                <code className="block break-all rounded-std border border-hairline bg-surface px-2 py-1.5 font-mono text-sm text-ink">
                  {secret}
                </code>
              </>
            ) : null}
            {otpauth ? (
              <a href={otpauth} className="text-sm text-brand hover:underline">
                {t("auth.mfa.otpauthLink")}
              </a>
            ) : null}
          </div>

          <label className="flex flex-col gap-1.5">
            <span className="text-sm text-ink-muted">{t("auth.mfa.verifyBody")}</span>
            <Input
              value={code}
              onChange={(e) => setCode(e.target.value)}
              inputMode="numeric"
              autoComplete="one-time-code"
              aria-label={t("auth.twofa.codeLabel")}
              required
            />
          </label>

          <ErrorNote>{error || null}</ErrorNote>
          <Button type="submit" disabled={busy} className="w-full justify-center">
            {busy ? t("auth.submitting") : t("auth.mfa.verify")}
          </Button>
        </form>
      ) : null}

      {step === "done" ? (
        <div className="flex flex-col gap-4">
          <PendingNote tone="ok">{t("auth.mfa.enabledBody")}</PendingNote>
          {backupCodes.length > 0 ? (
            <div className="flex flex-col gap-2 rounded-std border border-hairline bg-surface-raised p-4">
              <strong className="text-sm font-semibold text-ink">{t("auth.mfa.backupTitle")}</strong>
              <p className="text-sm text-ink-muted">{t("auth.mfa.backupBody")}</p>
              <ul className="grid grid-cols-2 gap-1.5 font-mono text-sm text-ink">
                {backupCodes.map((c) => (
                  <li key={c} className="rounded-std border border-hairline bg-surface px-2 py-1">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <Button type="button" onClick={finish} className="w-full justify-center">
            {t("auth.mfa.done")}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
