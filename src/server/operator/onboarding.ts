/**
 * OWNER-SETUP / ONBOARDING-VERSAND (Punkt 4b).
 *
 * Nach dem Provisioning bekommt das frisch angelegte Owner-Konto (auf dem NEUEN
 * Tenant `<slug>.hallofhelp.com`, ohne Passwort) einen Set-Passwort-/Onboarding-
 * Link über den BESTEHENDEN Reset-Mechanismus von better-auth
 * (`requestPasswordReset`): das erzeugt einen tenant-gescopeten Reset-Token,
 * versendet den Link via Resend (inert ohne `RESEND_API_KEY`) und — über den
 * `captureResetUrl`-Hook in `createAuth` — reicht uns die URL zurück.
 *
 * ISOLATION: der Aufruf läuft strikt im Kontext des NEUEN Tenants
 * (`runWithTenant(tenant.id, …)`) mit einer eigens dafür gebauten better-auth-
 * Instanz; es findet KEIN Cross-Instance-Zugriff statt. Der Reset-Token lebt in
 * `auth_verification` des neuen Tenants.
 *
 * `devLink` (dev-only): ohne konfigurierten Mail-Key UND außerhalb Produktion
 * geben wir die URL zurück, damit man den Flow ohne Mailserver durchspielen kann
 * — analog `devAcceptUrl` bei Team-Einladungen. In Produktion ist `devLink` NIE
 * gesetzt (der Link steckt dann ausschließlich in der Mail).
 */

import type { Tenant } from "@/lib/tenant/types";
import { createAuth } from "@/server/auth/runtime";
import { runWithTenant } from "@/server/auth/tenant-context";

/** Ergebnis des Owner-Setup-Versands. */
export interface OwnerSetupResult {
  /** `true` = Mail wirklich versandt (Key gesetzt). */
  sent: boolean;
  /** NUR dev/ohne Key: der Set-Passwort-Link (sonst `undefined`). */
  devLink?: string;
}

/**
 * Baut die Runtime-Implementierung von `sendOwnerSetup` (siehe ApiDeps).
 * `env` trägt D1 + AUTH_SECRET (+ optional RESEND_API_KEY). Ohne D1 wird der
 * Operator-Dep gar nicht erst gebaut (runtime-deps → 503), diese Funktion läuft
 * also nur mit echten Bindings.
 */
export function makeSendOwnerSetup(env: CloudflareEnv & { RESEND_API_KEY?: string }) {
  return async function sendOwnerSetup(input: {
    tenant: Tenant;
    ownerEmail: string;
  }): Promise<OwnerSetupResult> {
    let capturedUrl: string | null = null;
    const auth = await createAuth(env, input.tenant, {
      captureResetUrl: (url) => {
        capturedUrl = url;
      },
    });

    await runWithTenant(input.tenant.id, async () => {
      try {
        await auth.api.requestPasswordReset({
          body: {
            email: input.ownerEmail,
            // Landing auf der Reset-Seite des NEUEN Tenants (Slug-Host, A-7).
            redirectTo: `https://${input.tenant.slug}.hallofhelp.com/reset-password`,
          },
        });
      } catch (err) {
        // Versand ist Best-Effort: ein Fehler hier darf das bereits erfolgte
        // Provisioning NICHT zurücknehmen (der Owner kann den Link jederzeit
        // selbst über „Passwort vergessen" auf seinem Host anfordern).
        console.error("[operator/onboarding] requestPasswordReset failed:", err);
      }
    });

    const sent = !!env.RESEND_API_KEY;
    const devLink =
      !sent && process.env.NODE_ENV !== "production" && capturedUrl ? capturedUrl : undefined;
    return { sent, devLink };
  };
}
