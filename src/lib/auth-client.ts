"use client";

import { createAuthClient } from "better-auth/react";
import { twoFactorClient } from "better-auth/client/plugins";
import { AUTH_BASE_PATH } from "@/lib/auth/base-path";

/**
 * BETTER-AUTH REACT-CLIENT (Punkt 4a-1).
 *
 * Cookie-basierte Sessions (better-auth-Default): der Client sendet/empfängt die
 * Session als HttpOnly-Cookie über same-origin-Requests — es werden NIEMALS
 * Tokens in localStorage/JS gehalten. `basePath` zeigt auf unseren Mount
 * (/api/v1/auth); die `baseURL` leitet der Client aus der aktuellen Tenant-Origin
 * ab (window.location) — pro Tenant-Host also automatisch die richtige Instanz.
 *
 * VERIFIZIERTE Exporte/Signaturen (better-auth 1.6.23, node_modules):
 *  - `createAuthClient` aus "better-auth/react" (Package-Export `./react`).
 *  - `twoFactorClient()` aus "better-auth/client/plugins" (Package-Export
 *    `./client/plugins`); Optionen sind optional — wir setzen bewusst KEINE
 *    `twoFactorPage`/`onTwoFactorRedirect`, weil die 2FA-Challenge INLINE im
 *    Login-Formular läuft (wir werten `data.twoFactorRedirect` selbst aus).
 *  - Der Client stellt daraus u. a. bereit: `signIn.email`, `signIn.social`,
 *    `signUp.email`, `forgetPassword`, `resetPassword`, `sendVerificationEmail`,
 *    `signOut`, `useSession`, und den `twoFactor.*`-Namespace
 *    (`enable`/`getTotpUri`/`verifyTotp`/`sendOtp`/`verifyOtp`/
 *    `generateBackupCodes`/`verifyBackupCode`).
 */
export const authClient = createAuthClient({
  basePath: AUTH_BASE_PATH,
  plugins: [twoFactorClient()],
});

/** React-Hook für den aktuellen Session-Zustand (reaktiv, cookie-gestützt). */
export const useSession = authClient.useSession;

/** Zwei-Faktor-Aktionen (Setup + Challenge). */
export const twoFactor = authClient.twoFactor;

/** E-Mail+Passwort-Anmeldung. Bei aktivem 2FA trägt `data.twoFactorRedirect`. */
export function signInEmail(input: { email: string; password: string; rememberMe?: boolean }) {
  return authClient.signIn.email(input);
}

/**
 * Turnstile-Token als Request-Header (better-auth-captcha-Konvention,
 * `x-captcha-response`). `undefined` ohne Token — der Server entscheidet dann
 * je nach Umgebung (dev: Schutz aus, Prod: 400 MISSING_RESPONSE, fail-closed).
 */
function captchaHeaders(turnstileToken?: string | null) {
  return turnstileToken ? { headers: { "x-captcha-response": turnstileToken } } : undefined;
}

/** Registrierung mit E-Mail+Passwort+Name; `callbackURL` = Verifizierungs-Landing. */
export function signUpEmail(input: {
  email: string;
  password: string;
  name: string;
  callbackURL?: string;
  /** Turnstile-Token (Pflicht, sobald der Tenant-Host einen Site-Key hat). */
  turnstileToken?: string | null;
}) {
  const { turnstileToken, ...body } = input;
  return authClient.signUp.email(body, captchaHeaders(turnstileToken));
}

/** Passwort-Reset anfordern (Link an die E-Mail; `redirectTo` = Reset-Seite). */
export function requestPasswordReset(input: {
  email: string;
  redirectTo?: string;
  /** Turnstile-Token (Pflicht, sobald der Tenant-Host einen Site-Key hat). */
  turnstileToken?: string | null;
}) {
  const { turnstileToken, ...body } = input;
  return authClient.requestPasswordReset(body, captchaHeaders(turnstileToken));
}

/** Passwort mit Token aus dem Reset-Link neu setzen. */
export function resetPassword(input: { newPassword: string; token: string }) {
  return authClient.resetPassword(input);
}

/** Verifizierungs-E-Mail erneut senden. */
export function resendVerificationEmail(input: { email: string; callbackURL?: string }) {
  return authClient.sendVerificationEmail(input);
}

/** Abmelden (löscht das Session-Cookie serverseitig). */
export function signOut() {
  return authClient.signOut();
}

/**
 * Liest die Rolle der aktuellen Session (cookie-gestützt) — für die
 * Redirect-Zielbestimmung nach 2FA/Social, wo das Rollenfeld nicht schon aus der
 * Sign-in-Antwort vorliegt. `null`, wenn keine Session/keine Rolle.
 */
export async function getSessionRole(): Promise<string | null> {
  const { data } = await authClient.getSession();
  const role = (data?.user as { role?: string } | undefined)?.role;
  return role ?? null;
}

/**
 * Social-Login-START. Läuft über den generischen Client-Call
 * `signIn.social` → POST /api/v1/auth/sign-in/social; diese Route ist
 * serverseitig gewrappt (app.ts): better-auths Authorization-URL wird in den
 * signierten OAuth-Gateway-Umschlag gesteckt und als `data.url` zurückgegeben.
 * Wir navigieren den Browser genau dorthin. Der Gateway (auth.hallofhelp.com)
 * packt den Umschlag aus und leitet den Provider-Callback zurück an die
 * Tenant-Origin, wo better-auth den Code-Exchange abschließt.
 */
export async function startSocialSignIn(
  provider: "google" | "microsoft",
  opts: { callbackURL: string; errorCallbackURL?: string },
): Promise<{ error?: unknown }> {
  const { data, error } = await authClient.signIn.social({
    provider,
    callbackURL: opts.callbackURL,
    errorCallbackURL: opts.errorCallbackURL,
  });
  if (error) return { error };
  const url = (data as { url?: string } | null)?.url;
  if (typeof url === "string" && url.length > 0) {
    window.location.href = url;
  }
  return {};
}
