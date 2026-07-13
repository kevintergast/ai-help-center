import type { MessageKey } from "@/i18n/messages/de";

/**
 * FEHLER-MAPPING better-auth → nutzerfreundliche, übersetzte Meldung (Punkt 4a).
 *
 * Rein/testbar. Bildet den stabilen better-auth-Fehlercode (`error.code`) auf
 * einen `auth.error.*`-i18n-Key ab. Grundsätze:
 *  - KEINE Account-Enumeration: falsche Zugangsdaten und „E-Mail nicht bestätigt"
 *    laufen bei der ANMELDUNG in EINE generische Meldung (der Aufrufer entscheidet
 *    per `context`, ob z. B. beim Sign-up der „bereits vergeben"-Hinweis okay ist).
 *  - Unbekannte/fehlende Codes → generische Meldung (nie Rohtext des Backends).
 *  - Fehlt ein `code` ganz (Netzwerk-/Fetch-Fehler), greift `network`.
 */

/** Minimales Fehlerobjekt, wie es der better-auth-Client liefert. */
export interface AuthErrorLike {
  code?: string | null;
  status?: number | null;
  message?: string | null;
}

/** Kontext der Meldung — steuert, wie „streng" (anti-enumeration) gemappt wird. */
export type AuthErrorContext = "signIn" | "signUp" | "twoFactor" | "reset" | "generic";

const GENERIC: MessageKey = "auth.error.generic";

/**
 * `code` → i18n-Key. Codes stammen aus better-auth v1.6.23 (verifiziert in
 * node_modules: BASE_ERROR_CODES + two-factor/error-code).
 */
const CODE_MAP: Record<string, MessageKey> = {
  INVALID_EMAIL_OR_PASSWORD: "auth.error.invalidCredentials",
  INVALID_PASSWORD: "auth.error.invalidCredentials",
  CREDENTIAL_ACCOUNT_NOT_FOUND: "auth.error.invalidCredentials",
  EMAIL_NOT_VERIFIED: "auth.error.emailNotVerified",
  USER_ALREADY_EXISTS: "auth.error.emailInUse",
  USER_ALREADY_EXISTS_USE_ANOTHER_EMAIL: "auth.error.emailInUse",
  BANNED_USER: "auth.error.banned",
  PASSWORD_COMPROMISED: "auth.error.passwordCompromised",
  PASSWORD_TOO_SHORT: "auth.error.passwordTooShort",
  PASSWORD_TOO_LONG: "auth.error.generic",
  INVALID_TOKEN: "auth.error.linkInvalid",
  ACCOUNT_TEMPORARILY_LOCKED: "auth.error.accountLocked",
  TOO_MANY_ATTEMPTS: "auth.error.tooManyAttempts",
  TOO_MANY_ATTEMPTS_REQUEST_NEW_CODE: "auth.error.tooManyAttempts",
  INVALID_CODE: "auth.error.invalidCode",
  INVALID_OTP: "auth.error.invalidCode",
  INVALID_BACKUP_CODE: "auth.error.invalidCode",
  INVALID_TWO_FACTOR_COOKIE: "auth.error.codeExpired",
  OTP_EXPIRED: "auth.error.codeExpired",
  OTP_HAS_EXPIRED: "auth.error.codeExpired",
  // Eigene MFA-Policy-Codes (src/server/auth/mfa-policy.ts): admin/owner nur TOTP.
  otp_not_allowed_for_role: "auth.error.totpRequired",
  mfa_policy_unavailable: "auth.error.generic",
};

/**
 * Bei der ANMELDUNG dürfen „falsches Passwort" und „E-Mail nicht bestätigt"
 * kein Existenz-Orakel bilden — beide auf die generische Zugangsdaten-Meldung
 * kollabieren. `emailNotVerified` bleibt erhalten, DAMIT der Login-Flow den
 * Nutzer zur Verifizierung leiten kann (der Aufrufer behandelt diesen Code
 * gesondert), wird hier also NICHT verwässert; nur `invalidCredentials` ist
 * bereits generisch.
 */
export function mapAuthError(
  error: AuthErrorLike | null | undefined,
  _context: AuthErrorContext = "generic",
): MessageKey {
  if (!error) return GENERIC;
  const code = error.code ?? undefined;
  if (!code) {
    // Kein Code: entweder ein reiner Transport-/Netzwerkfehler (status 0/fehlt)
    // oder eine unklassifizierte Server-Antwort → generisch bzw. Netzwerk.
    return error.status && error.status > 0 ? GENERIC : "auth.error.network";
  }
  return CODE_MAP[code] ?? GENERIC;
}
