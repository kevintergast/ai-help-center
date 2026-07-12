import type { MessageKey } from "@/i18n/messages/de";

/**
 * FORM-VALIDIERUNG (Punkt 4a) — rein/testbar, gibt bei Fehler einen
 * `auth.validate.*`-i18n-Key zurück, sonst `null`. Bewusst client-seitige
 * Vorprüfung (die autoritative Prüfung bleibt serverseitig in better-auth):
 * verhindert offensichtlich sinnlose Requests und gibt sofortiges Feedback.
 */

/** Passwort-Mindestlänge — deckungsgleich mit auth.ts (`minPasswordLength: 10`). */
export const MIN_PASSWORD_LENGTH = 10;

/** Länge eines TOTP-/E-Mail-OTP-Codes (six digits). */
export const OTP_CODE_LENGTH = 6;

// Pragmatische E-Mail-Form (kein RFC-Parser): ein @-Zeichen, Text davor/danach,
// ein Punkt in der Domain. Reicht als Tippfehler-Vorfilter.
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateEmail(value: string): MessageKey | null {
  const v = value.trim();
  if (v.length === 0) return "auth.validate.emailRequired";
  if (v.length > 254 || !EMAIL_RE.test(v)) return "auth.validate.emailInvalid";
  return null;
}

export function validatePassword(value: string): MessageKey | null {
  if (value.length === 0) return "auth.validate.passwordRequired";
  if (value.length < MIN_PASSWORD_LENGTH) return "auth.validate.passwordTooShort";
  return null;
}

export function validateName(value: string): MessageKey | null {
  if (value.trim().length === 0) return "auth.validate.nameRequired";
  return null;
}

/** Prüft einen 2FA-Code (genau 6 Ziffern). */
export function validateOtpCode(value: string): MessageKey | null {
  const v = value.trim();
  if (!new RegExp(`^\\d{${OTP_CODE_LENGTH}}$`).test(v)) return "auth.validate.codeInvalid";
  return null;
}

/** Bestätigungsfeld: nicht leer + gleich dem Passwort. */
export function validatePasswordConfirm(pw: string, confirm: string): MessageKey | null {
  const base = validatePassword(pw);
  if (base) return base;
  if (pw !== confirm) return "auth.reset.mismatch";
  return null;
}
