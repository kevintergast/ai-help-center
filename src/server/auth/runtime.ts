import { betterAuth } from "better-auth";
import type { BetterAuthOptions } from "better-auth";
import { getAdapter } from "better-auth/db/adapter";
import type { Tenant } from "@/lib/tenant/types";
import { tenantAuthOptions } from "./auth";
import { createEmailSenders } from "./resend";
import { getAuthSecret } from "./secret";
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

/** Basis-Domain für Tenant-Subdomains (Slug-Auflösung). */
const BASE_DOMAIN = "hallofhelp.app";

/**
 * Leitet die Origin/`baseURL` des Tenants ab: IMMER `<slug>.hallofhelp.app`,
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
export function tenantBaseURL(tenant: Tenant): string {
  return `https://${tenant.slug}.${BASE_DOMAIN}`;
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
  env: CloudflareEnv & { RESEND_API_KEY?: string },
  tenant: Tenant,
): Promise<ReturnType<typeof betterAuth>> {
  const secret = await getAuthSecret(env);
  const senders = createEmailSenders(env);
  // Phase C: TOTP-Issuer = Tenant-Slug (erscheint in der Authenticator-App);
  // Email-OTP (nur content) läuft über den Resend-Sender (inert ohne Key).
  const base = tenantAuthOptions(secret, {
    issuer: tenant.slug,
    sendOtpEmail: senders.sendOtpEmail,
  });

  // Innerer Adapter aus der D1-Bindung (auto-detektiert -> D1SqliteDialect).
  const inner = await getAdapter({ ...base, database: env.DB });

  const options: BetterAuthOptions = {
    ...base,
    baseURL: tenantBaseURL(tenant),
    database: () => tenantAwareAdapter(inner),
    emailAndPassword: {
      ...base.emailAndPassword,
      enabled: true,
      sendResetPassword: senders.sendResetPassword,
    },
    emailVerification: {
      ...base.emailVerification,
      sendVerificationEmail: senders.sendVerificationEmail,
    },
  };

  return betterAuth(options);
}
