"use client";

import type { Locale } from "@/lib/tenant/types";
import { getSessionRole } from "@/lib/auth-client";
import { resolvePostLoginRedirect } from "@/lib/auth/redirect";
import { TwoFactorChallenge } from "./two-factor-challenge";

/**
 * Eigenständige 2FA-Step-up-Seite (/mfa): fordert eine erneute
 * Zweitfaktor-Bestätigung (z. B. verlinkt vor sensiblen Aktionen). Nach Erfolg
 * Redirect auf den sicheren `?redirect`-Wunsch bzw. das rollen-basierte Zuhause.
 */
export function MfaChallengePanel({
  locale,
  requestedRedirect,
}: {
  locale: Locale;
  requestedRedirect: string | null;
}) {
  async function onVerified() {
    const role = await getSessionRole();
    window.location.assign(resolvePostLoginRedirect({ role, requested: requestedRedirect }));
  }
  return <TwoFactorChallenge locale={locale} onVerified={onVerified} />;
}
