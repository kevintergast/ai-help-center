"use client";

import { useState, type FormEvent } from "react";
import { getT } from "@/i18n/t";
import type { Locale } from "@/lib/tenant/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { twoFactor } from "@/lib/auth-client";
import { mapAuthError } from "@/lib/auth/errors";
import { validateOtpCode } from "@/lib/auth/validate";
import { ErrorNote, PendingNote } from "./notes";

type Mode = "totp" | "otp" | "backup";

/**
 * 2FA-CHALLENGE (inline). Wird sowohl bei der Anmeldung (nach
 * `twoFactorRedirect`) als auch als eigenständige Step-up-Seite (/mfa) genutzt.
 * Unterstützt TOTP (Authenticator-App), Email-OTP (anfordern + eingeben) und
 * Backup-Codes. Ruft bei Erfolg `onVerified()` — der Aufrufer entscheidet über
 * das Redirect-Ziel. Cookie-basiert: der Verify-Endpunkt setzt die
 * mfa-verifizierte Session serverseitig, hier werden KEINE Tokens gehalten.
 */
export function TwoFactorChallenge({
  locale,
  methods,
  onVerified,
}: {
  locale: Locale;
  methods?: string[];
  onVerified: () => void | Promise<void>;
}) {
  const t = getT(locale);
  const canOtp = !methods || methods.includes("otp");
  const [mode, setMode] = useState<Mode>("totp");
  const [code, setCode] = useState("");
  const [otpSent, setOtpSent] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);

  function switchMode(next: Mode) {
    setMode(next);
    setCode("");
    setError("");
    setNotice("");
    setOtpSent(false);
  }

  async function sendOtp() {
    setBusy(true);
    setError("");
    const { error: err } = await twoFactor.sendOtp();
    setBusy(false);
    if (err) {
      // admin/owner: Email-OTP ist serverseitig verboten -> zurück auf TOTP lenken.
      if ((err as { code?: string }).code === "otp_not_allowed_for_role") switchMode("totp");
      setError(t(mapAuthError(err, "twoFactor")));
      return;
    }
    setOtpSent(true);
    setNotice(t("auth.twofa.otpSent"));
  }

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError("");
    if (mode !== "backup") {
      const codeError = validateOtpCode(code);
      if (codeError) {
        setError(t(codeError));
        return;
      }
    }
    setBusy(true);
    const action =
      mode === "totp"
        ? twoFactor.verifyTotp({ code })
        : mode === "otp"
          ? twoFactor.verifyOtp({ code })
          : twoFactor.verifyBackupCode({ code });
    const { error: err } = await action;
    if (err) {
      setBusy(false);
      // admin/owner: Email-OTP/Backup-Code serverseitig verboten -> auf TOTP lenken.
      if ((err as { code?: string }).code === "otp_not_allowed_for_role") switchMode("totp");
      setError(t(mapAuthError(err, "twoFactor")));
      return;
    }
    await onVerified();
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-ink-muted">
        {mode === "totp"
          ? t("auth.twofa.totpPrompt")
          : mode === "otp"
            ? t("auth.twofa.otpPrompt")
            : t("auth.twofa.backupPrompt")}
      </p>

      {notice ? <PendingNote tone="ok">{notice}</PendingNote> : null}

      {mode === "otp" && !otpSent ? (
        <Button type="button" variant="cream" onClick={sendOtp} disabled={busy}>
          {t("auth.twofa.sendOtp")}
        </Button>
      ) : (
        <Input
          label={mode === "backup" ? t("auth.twofa.backupLabel") : t("auth.twofa.codeLabel")}
          value={code}
          onChange={(e) => setCode(e.target.value)}
          inputMode={mode === "backup" ? "text" : "numeric"}
          autoComplete="one-time-code"
          autoFocus
          required
        />
      )}

      <ErrorNote>{error || null}</ErrorNote>

      {!(mode === "otp" && !otpSent) ? (
        <Button type="submit" disabled={busy} className="w-full justify-center">
          {busy ? t("auth.submitting") : t("auth.twofa.verify")}
        </Button>
      ) : null}

      <div className="flex flex-col gap-1.5 text-center text-sm">
        {mode !== "totp" ? (
          <button type="button" className="text-brand hover:underline" onClick={() => switchMode("totp")}>
            {t("auth.twofa.useTotp")}
          </button>
        ) : null}
        {mode !== "otp" && canOtp ? (
          <button type="button" className="text-brand hover:underline" onClick={() => switchMode("otp")}>
            {t("auth.twofa.useOtp")}
          </button>
        ) : null}
        {mode !== "backup" ? (
          <button
            type="button"
            className="text-brand hover:underline"
            onClick={() => switchMode("backup")}
          >
            {t("auth.twofa.useBackup")}
          </button>
        ) : null}
      </div>
    </form>
  );
}
