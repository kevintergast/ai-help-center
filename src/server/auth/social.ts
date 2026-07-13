import type { BetterAuthOptions } from "better-auth";
import { gatewayRedirectURI, type SocialProviderId } from "./oauth-gateway";

/**
 * PHASE E — Social-Provider-Konfiguration (Google + Microsoft).
 *
 * Grundsätze (Design §c-3/§g):
 *  - `redirectURI` je Provider zeigt auf den ZENTRALEN Gateway-Host
 *    (auth.hallofhelp.com). Verifiziert: better-auth setzt die `redirect_uri`
 *    sowohl im Authorization-Request als auch im Token-Exchange als
 *    `options.redirectURI || <computed>` — die Provider-Config gewinnt und hält
 *    beide Seiten deckungsgleich.
 *  - Microsoft `tenantId: "common"` (Work-/School- UND persönliche Konten).
 *  - Scopes minimal: `openid`, `email`, `profile` (via `disableDefaultScope`,
 *    damit NICHT die breiteren Provider-Defaults wie `User.Read`/`offline_access`
 *    angefordert werden). Microsoft-Profilfoto (bräuchte `User.Read`/Graph) ist
 *    deaktiviert; E-Mail/Name kommen aus dem verifizierten id_token.
 *  - `accountLinking` bleibt GLOBAL aus (auth.ts) — hier nichts, was linkt.
 *  - Fehlt Client-ID ODER Secret eines Providers, wird er NICHT registriert
 *    (kein Crash) — better-auth würde sonst erst beim Sign-in werfen.
 */

/** Client-ID/Secret eines Providers (aus env oder Test-Fixture). */
export interface SocialCredential {
  clientId?: string;
  clientSecret?: string;
}

/**
 * Eingabe für die Provider-Registrierung. Neben den Credentials dürfen weitere
 * Felder durchgereicht werden (z. B. `verifyIdToken`/`getUserInfo`-Overrides in
 * Tests, um den Provider-HTTP-Verkehr zu MOCKEN — better-auths google/microsoft
 * lesen genau diese Options-Hooks). Produktiv werden diese Felder nicht gesetzt.
 */
export interface SocialProvidersInput {
  google?: SocialCredential & Record<string, unknown>;
  microsoft?: SocialCredential & Record<string, unknown>;
}

/** Minimale, für alle Provider identische OIDC-Scopes. */
const MINIMAL_SCOPES = ["openid", "email", "profile"] as const;

function hasCredentials(cfg: SocialCredential | undefined): cfg is SocialCredential {
  return !!cfg && typeof cfg.clientId === "string" && cfg.clientId.length > 0 &&
    typeof cfg.clientSecret === "string" && cfg.clientSecret.length > 0;
}

/**
 * Baut die `socialProviders`-Option für better-auth aus den (optionalen)
 * Credentials. Nur vollständig konfigurierte Provider landen im Ergebnis;
 * ist keiner konfiguriert, wird `undefined` zurückgegeben (kein leeres Objekt,
 * damit `Object.entries` im Core sauber leer bleibt).
 */
export function buildSocialProviders(
  input: SocialProvidersInput | undefined,
): BetterAuthOptions["socialProviders"] {
  if (!input) return undefined;
  const out: Record<string, unknown> = {};

  if (hasCredentials(input.google)) {
    const { clientId, clientSecret, ...rest } = input.google;
    out.google = {
      ...rest,
      clientId,
      clientSecret,
      redirectURI: gatewayRedirectURI("google"),
      disableDefaultScope: true,
      scope: [...MINIMAL_SCOPES],
    };
  }

  if (hasCredentials(input.microsoft)) {
    const { clientId, clientSecret, ...rest } = input.microsoft;
    out.microsoft = {
      ...rest,
      clientId,
      clientSecret,
      tenantId: "common",
      redirectURI: gatewayRedirectURI("microsoft"),
      disableDefaultScope: true,
      scope: [...MINIMAL_SCOPES],
      disableProfilePhoto: true,
    };
  }

  return Object.keys(out).length > 0
    ? (out as BetterAuthOptions["socialProviders"])
    : undefined;
}

/**
 * Leitet aus den (optionalen) Credentials ab, WELCHE Social-Provider für den
 * Nutzer verfügbar sind (vollständige Client-ID + Secret). Reine, testbare
 * Ableitung — das Login-/Signup-UI blendet nicht konfigurierte Provider (heute:
 * Microsoft ohne Key) damit einfach aus, ohne Code-Änderung. Reihenfolge stabil
 * (google, microsoft), damit die UI deterministisch rendert.
 */
export function availableSocialProviders(
  input: SocialProvidersInput | undefined,
): SocialProviderId[] {
  const out: SocialProviderId[] = [];
  if (hasCredentials(input?.google)) out.push("google");
  if (hasCredentials(input?.microsoft)) out.push("microsoft");
  return out;
}

/** Liest die Provider-Credentials aus der Cloudflare-Umgebung (Phase E). */
export function socialProvidersFromEnv(env: {
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;
  MICROSOFT_CLIENT_ID?: string;
  MICROSOFT_CLIENT_SECRET?: string;
}): SocialProvidersInput {
  return {
    google: { clientId: env.GOOGLE_CLIENT_ID, clientSecret: env.GOOGLE_CLIENT_SECRET },
    microsoft: { clientId: env.MICROSOFT_CLIENT_ID, clientSecret: env.MICROSOFT_CLIENT_SECRET },
  };
}
