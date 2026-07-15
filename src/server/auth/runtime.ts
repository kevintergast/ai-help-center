import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { getAdapter } from "better-auth/db/adapter";
import type { Tenant } from "@/lib/tenant/types";
import { buildCaptchaPlugin, turnstileConfigFromEnv } from "@/server/security/turnstile";
import { tenantAuthOptions } from "./auth";
import { createEmailSenders } from "./resend";
import { getAuthSecret } from "./secret";
import { socialProvidersFromEnv } from "./social";
import { tenantAwareAdapter } from "./tenant-adapter";

/**
 * D1-RUNTIME-FACTORY (Aufgabe 2).
 *
 * Baut eine ECHTE D1-gestützte better-auth-Instanz für einen konkreten Tenant.
 * Weg: better-auth erkennt die D1-Bindung (`batch`/`exec`/`prepare`) selbst und
 * nutzt seinen eingebauten Kysely-`D1SqliteDialect` — es ist KEINE externe
 * `kysely-d1`-Dependency nötig. Wir bauen den inneren Adapter mit `getAdapter`
 * (exakt der Mechanismus, den better-auth-Core intern verwendet) und umschließen
 * ihn mit `tenantAwareAdapter`, sodass jede DB-Operation an den Tenant-Kontext
 * gekoppelt bleibt.
 *
 * Schema-Parität: die better-auth-Optionen kommen aus `tenantAuthOptions(secret)`
 * — dieselbe Basis wie im Memory-Pfad (`buildAuth`), damit Core und Adapter
 * dasselbe Feld-/`tenantId`-Schema sehen (kein Drift).
 *
 * `baseURL` wird aus dem Tenant-Slug abgeleitet (tenantBaseURL — bewusst NIE
 * aus der unverifizierten custom_domain), was die "Base URL not set"-Warnung
 * behebt und Verifikations-/Reset-Links korrekt UND sicher macht.
 */

/**
 * Fallback-Basis-Domain (Prod). Pro Worker über die Env-Var `APP_BASE_DOMAIN`
 * überschreibbar (Dev-/Staging-Worker: "dev.hallofhelp.com"), damit der Auth-Origin
 * auf den TATSÄCHLICHEN Host dieses Workers zeigt — OHNE die Domain aus dem
 * (spoofbaren) Request-Host abzuleiten. Fehlt die Var → Prod-Domain (fail-safe:
 * auf Prod kann nie versehentlich ein Dev-Origin als trusted gelten).
 */
const BASE_DOMAIN = "hallofhelp.com";

/**
 * Leitet die Origin/`baseURL` des Tenants ab: IMMER `<slug>.hallofhelp.com`,
 * immer HTTPS.
 *
 * BEWUSST OHNE `tenant.customDomain` (A-7, fail-closed): `tenants.custom_domain`
 * trägt keinen Ownership-Beweis — das Verified-Gating lebt in `tenant_domain`
 * (TXT-Proof, status='verified'), und der Verifikations-Flow existiert noch
 * nicht. Über diese URL werden SECRETS versandt (Einladungs-/Verifikations-/
 * Reset-Links, Phase D): eine eingetragene, aber nicht kontrollierte Domain
 * (Vertipper, ausgelaufen, Fremd-Claim) würde einlösbare Tokens auf einen
 * fremden Host schicken. Die Slug-Subdomain funktioniert garantiert, weil die
 * Auflösung host-basiert ist. Wenn der Verifikations-Flow existiert: hier auf
 * `tenant_domain.status='verified'` umstellen, NICHT auf `customDomain` roh.
 */
export function tenantBaseURL(tenant: Tenant, baseDomain: string = BASE_DOMAIN): string {
  return `https://${tenant.slug}.${baseDomain}`;
}

/**
 * Baut eine tenant-isolierte, D1-gestützte better-auth-Instanz.
 *
 * @param env    Cloudflare-Bindings (mind. `DB` und `AUTH_SECRET`; optional `RESEND_API_KEY`).
 * @param tenant Der aufgelöste Mandant (liefert `baseURL`).
 *
 * Der Aufrufer MUSS API-Aufrufe in `runWithTenant(tenant.id, ...)` einbetten —
 * der `tenantAwareAdapter` liest die aktive `tenantId` erst zur Aufrufzeit.
 */
export async function createAuth(
  env: CloudflareEnv & { RESEND_API_KEY?: string; APP_BASE_DOMAIN?: string },
  tenant: Tenant,
  opts?: {
    /**
     * Operator-Onboarding (Punkt 4b): Beobachter für die generierte Reset-/
     * Set-Passwort-URL. better-auths `requestPasswordReset` ruft
     * `sendResetPassword({ url })` — dieser Hook fängt die URL ab (versandt wird
     * sie unverändert über Resend, inert ohne Key), damit der Provisioning-Flow
     * dem Owner einen Onboarding-Link geben und dev-only als `devLink`
     * zurückreichen kann. Ändert den Versand NICHT.
     */
    captureResetUrl?: (url: string) => void;
  },
): Promise<ReturnType<typeof betterAuth>> {
  const secret = await getAuthSecret(env);
  const senders = createEmailSenders(env);
  // Phase C: TOTP-Issuer = Tenant-Slug (erscheint in der Authenticator-App);
  // Email-OTP (nur content) läuft über den Resend-Sender (inert ohne Key).
  const base = tenantAuthOptions(secret, {
    issuer: tenant.slug,
    sendOtpEmail: senders.sendOtpEmail,
    // Phase E: Google/Microsoft aus der Umgebung; fehlt ein Key-Paar, wird der
    // Provider in buildSocialProviders NICHT registriert (kein Crash).
    socialProviders: socialProvidersFromEnv(env),
  });

  // Innerer Adapter aus der D1-Bindung (auto-detektiert -> D1SqliteDialect).
  const inner = await getAdapter({ ...base, database: env.DB });

  // TURNSTILE (Infra-Plan Schritt 2): Bot-Schutz auf Signup + Reset-Anforderung.
  // dev ohne Secret → Plugin aus (inert); Prod ohne Secret → Plugin fail-closed
  // (Details/Matrix: security/turnstile.ts). Anhängen NACH tenantTwoFactor-
  // SchemaPlugin ist unkritisch (captcha ist reiner onRequest-Hook, kein Schema).
  const captchaPlugin = buildCaptchaPlugin(await turnstileConfigFromEnv(env));

  const options: BetterAuthOptions = {
    ...base,
    plugins: [...(base.plugins ?? []), ...(captchaPlugin ? [captchaPlugin] : [])],
    baseURL: tenantBaseURL(tenant, env.APP_BASE_DOMAIN ?? BASE_DOMAIN),
    // NUR lokales `next dev` (NODE_ENV!=production — im deployten Worker immer
    // "production"): dort läuft die App auf http://<slug>.localhost:<port>,
    // die baseURL zeigt aber auf die echte Basis-Domain → better-auths
    // Origin-Check würde JEDEN lokalen Login mit 403 INVALID_ORIGIN ablehnen.
    // Deployed bleibt der Check unverändert strikt (keine trustedOrigins).
    ...(process.env.NODE_ENV !== "production"
      ? {
          trustedOrigins: [
            "http://localhost:3000",
            "http://*.localhost:3000",
            "http://localhost:3005",
            "http://*.localhost:3005",
          ],
        }
      : {}),
    database: () => tenantAwareAdapter(inner),
    emailAndPassword: {
      ...base.emailAndPassword,
      enabled: true,
      sendResetPassword: async (data) => {
        opts?.captureResetUrl?.(data.url);
        await senders.sendResetPassword(data);
      },
    },
    emailVerification: {
      ...base.emailVerification,
      sendVerificationEmail: senders.sendVerificationEmail,
    },
  };

  return betterAuth(options);
}
