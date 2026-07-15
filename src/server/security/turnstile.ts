import { captcha } from "better-auth/plugins";
import { readSecretValue, type SecretLike } from "@/server/auth/secret";

/**
 * TURNSTILE-BOT-SCHUTZ (Infra-Plan Schritt 2).
 *
 * Zwei Einsatzorte, EIN Header (`x-captcha-response`, better-auth-Konvention):
 *  1. Auth-Endpunkte (Signup, Passwort-Reset-Anforderung) — über better-auths
 *     offizielles captcha-Plugin (buildCaptchaPlugin, eingehängt in createAuth).
 *  2. Tenant-Erstellung (Operator-Console) — eigene Prüfung über
 *     `ApiDeps.verifyTurnstile` (die Route liegt außerhalb von better-auth).
 *
 * FAIL-CLOSED-SEMANTIK (bewusst, analog Resend-„inert ohne Key"-Muster):
 *  - Secret konfiguriert  → echte siteverify-Prüfung (jede Umgebung).
 *  - Secret fehlt + PROD  → Prüfung schlägt IMMER fehl (Fehlkonfiguration darf
 *    Bot-Schutz nie stillschweigend abschalten; betroffen sind nur die
 *    geschützten Endpunkte, nicht Login/übrige Auth).
 *  - Secret fehlt + dev/tests → Prüfung wird übersprungen (lokal ohne Keys
 *    arbeiten; Tests injizieren Fakes).
 *
 * Sign-in ist BEWUSST nicht captcha-geschützt: accountLockout(5) begrenzt
 * Brute-Force, Login/Reset sind enumerationssicher, und Team-Logins (MFA)
 * sollen reibungslos bleiben. Bei Missbrauch später ergänzbar.
 */

/** Von Turnstile geschützte better-auth-Endpunkte (relativ zum Auth-basePath). */
export const CAPTCHA_PROTECTED_ENDPOINTS = ["/sign-up/email", "/request-password-reset"];

/** Header, in dem Clients das Turnstile-Token mitschicken (better-auth-Konvention). */
export const CAPTCHA_TOKEN_HEADER = "x-captcha-response";

/** Cloudflare-siteverify-Endpunkt (Turnstile). */
const SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";

/** Obergrenze für einen siteverify-Roundtrip — hängender Provider = fail-closed. */
const VERIFY_TIMEOUT_MS = 10_000;

/** Env-Ausschnitt, den Turnstile braucht (Bindings sind env-generiert untypisiert). */
export interface TurnstileEnv {
  TURNSTILE_SECRET_KEY?: SecretLike;
  APP_ENV?: string;
}

/** Ergebnis der Tenant-Erstellungs-Prüfung (Operator-Route). */
export type TurnstileVerdict = "ok" | "missing" | "failed" | "unavailable";

/** Signatur des injizierbaren Prüfers (ApiDeps.verifyTurnstile). */
export type TurnstileVerify = (
  token: string | null,
  remoteIp?: string | null,
) => Promise<TurnstileVerdict>;

/**
 * Ruft Cloudflares siteverify auf. `false` bei jedem Nicht-Erfolg (HTTP-Fehler,
 * Timeout, success:false) — es gibt bewusst keinen „unsicher, aber
 * durchlassen"-Zweig. `fetchImpl` ist für Tests injizierbar.
 */
export async function verifyTurnstileToken(input: {
  secretKey: string;
  token: string;
  remoteIp?: string | null;
  fetchImpl?: typeof fetch;
}): Promise<boolean> {
  const doFetch = input.fetchImpl ?? fetch;
  const form = new URLSearchParams({ secret: input.secretKey, response: input.token });
  if (input.remoteIp) form.set("remoteip", input.remoteIp);

  try {
    const res = await doFetch(SITEVERIFY_URL, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form.toString(),
      signal: AbortSignal.timeout(VERIFY_TIMEOUT_MS),
    });
    if (!res.ok) return false;
    const data = (await res.json()) as { success?: boolean };
    return data.success === true;
  } catch {
    return false;
  }
}

/**
 * Entscheidungskern des Tenant-Erstellungs-Prüfers — pur & testbar.
 * Semantik siehe Kopfkommentar (Secret×Umgebung-Matrix).
 */
export function makeTurnstileVerify(cfg: {
  secretKey: string | null;
  isProduction: boolean;
  fetchImpl?: typeof fetch;
}): TurnstileVerify {
  return async (token, remoteIp) => {
    if (!cfg.secretKey) return cfg.isProduction ? "unavailable" : "ok";
    if (!token) return "missing";
    const ok = await verifyTurnstileToken({
      secretKey: cfg.secretKey,
      token,
      remoteIp,
      fetchImpl: cfg.fetchImpl,
    });
    return ok ? "ok" : "failed";
  };
}

/**
 * better-auth-captcha-Plugin für die Auth-Endpunkte — oder `null`, wenn der
 * Schutz in DIESER Umgebung aus bleiben soll (dev/tests ohne Secret).
 *
 * PROD OHNE SECRET: Plugin wird MIT leerem Secret registriert — das Plugin
 * wirft dann intern (MISSING_SECRET_KEY) und antwortet 500 auf den geschützten
 * Endpunkten. Laut, fail-closed, und nur Signup/Reset-Request betroffen.
 */
export function buildCaptchaPlugin(cfg: {
  secretKey: string | null;
  isProduction: boolean;
}): ReturnType<typeof captcha> | null {
  if (!cfg.secretKey && !cfg.isProduction) return null;
  return captcha({
    provider: "cloudflare-turnstile",
    secretKey: cfg.secretKey ?? "",
    endpoints: CAPTCHA_PROTECTED_ENDPOINTS,
  });
}

/** Secret + Umgebung aus den Bindings lesen (Runtime-Helfer). */
export async function turnstileConfigFromEnv(
  env: TurnstileEnv,
): Promise<{ secretKey: string | null; isProduction: boolean }> {
  return {
    secretKey: await readSecretValue(env.TURNSTILE_SECRET_KEY),
    isProduction: env.APP_ENV === "production",
  };
}
