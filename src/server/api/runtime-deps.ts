import type { Tenant } from "@/lib/tenant/types";
import { resolveTenant as resolveFromRegistry } from "@/lib/tenant/resolve";
import { D1AuditRepository } from "@/server/auth/audit";
import { D1InvitationRepository } from "@/server/auth/invitations";
import { sendInvitationEmail } from "@/server/auth/resend";
import { createAuth } from "@/server/auth/runtime";
import { D1TeamUserRepository } from "@/server/auth/team-users";
import { D1BrandingRepository, type BrandingDeps } from "@/server/branding/store";
import { getDbSafe } from "@/server/db/client";
import { D1TenantRepository } from "@/server/tenant/repository";
import { resolveWithSourceStrict } from "@/server/tenant/resolve-tenant";
import type { ApiDeps, AuthInstance, TeamDeps } from "./context";

/**
 * ECHTE Runtime-Abhängigkeiten der API-App (Default-Instanz für die Next-Route).
 *
 * Tenant-Auflösung — Entscheidungslogik (dokumentiert):
 *  - D1 vorhanden (Worker / `next dev` mit Bindings): STRICT über
 *    `resolveWithSourceStrict` + `D1TenantRepository`. Unbekannter Host → null
 *    → die App antwortet 404, fail-closed. KEIN Demo-/Default-Fallback: eine
 *    gespoofte oder noch nicht provisionierte Instanz darf nie auf einen
 *    fremden/Demo-Tenant kollabieren.
 *  - KEIN D1 (rein lokale Entwicklung/Unit-Tests ohne Cloudflare-Kontext):
 *    Fallback auf die In-Memory-Demo-Registry (`@/lib/tenant/registry`).
 *    DEV-ONLY — dieser Zweig existiert im deployten Worker nicht, dort ist
 *    die DB-Bindung immer vorhanden.
 */
async function resolveTenantRuntime(host: string | null | undefined): Promise<Tenant | null> {
  const db = await getDbSafe();
  if (db) {
    return resolveWithSourceStrict(new D1TenantRepository(db), host);
  }
  // DEV-ONLY (kein Cloudflare-Kontext): Demo-Registry, wie vor Phase B.
  return resolveFromRegistry(host);
}

/**
 * Liefert die Cloudflare-Bindings zur Laufzeit — `null` ohne Cloudflare-Kontext
 * (Unit-Tests, reines `next dev` ohne Wrangler). Analog zu `getDbSafe`:
 * dynamischer Import + try/catch, wirft nie.
 */
export async function getEnvSafe(): Promise<CloudflareEnv | null> {
  try {
    const { getCloudflareContext } = await import("@opennextjs/cloudflare");
    const ctx = getCloudflareContext() as { env?: CloudflareEnv };
    return ctx.env ?? null;
  } catch {
    return null;
  }
}

/**
 * Baut die D1-gestützte better-auth-Instanz für den Tenant. Ohne
 * Cloudflare-Umgebung wird GEWORFEN (fail-closed) — es gibt bewusst keinen
 * Memory-/Demo-Auth-Fallback in der Default-Instanz: Auth ohne echte DB wäre
 * eine Attrappe. (Der Fehler landet im zentralen onError → 500;
 * die Default-Deny-Middleware behandelt ihn als "keine Session" → 401.)
 */
async function createAuthForTenantRuntime(tenant: Tenant): Promise<AuthInstance> {
  const env = await getEnvSafe();
  if (!env) {
    throw new Error(
      "createAuthForTenant: keine Cloudflare-Umgebung (D1/AUTH_SECRET) — Auth ist ohne Bindings nicht verfügbar (fail-closed).",
    );
  }
  return createAuth(env, tenant);
}

/**
 * Branding-Persistenz der Request-Runtime: D1 (Farben/Logo-Key) + R2 (`MEDIA`).
 * Fehlt eine der Bindings (Unit-Tests, `next dev` ohne Wrangler, R2 noch nicht
 * provisioniert), liefert dies `null` — die Branding-Routen antworten dann
 * 503 fail-closed statt in einen Fake-Speicher zu schreiben.
 */
async function getBrandingDepsRuntime(): Promise<BrandingDeps | null> {
  const env = await getEnvSafe();
  if (!env?.DB || !env.MEDIA) return null;
  return { repo: new D1BrandingRepository(env.DB), bucket: env.MEDIA };
}

/**
 * Team-Verwaltung (Phase D): Einladungen/Users/Audit auf D1 + Resend-Versand.
 * Ohne D1-Bindung → `null` → die Team-Routen antworten 503 fail-closed.
 * Der Versand ist ohne RESEND_API_KEY inert (No-op, `false`) — die Route
 * liefert dann dev-only den `devAcceptUrl` (Begründung: api/team.ts).
 */
async function getTeamDepsRuntime(): Promise<TeamDeps | null> {
  const env = await getEnvSafe();
  if (!env?.DB) return null;
  const mailEnv = env as CloudflareEnv & { RESEND_API_KEY?: string };
  return {
    invitations: new D1InvitationRepository(env.DB),
    users: new D1TeamUserRepository(env.DB),
    audit: new D1AuditRepository(env.DB),
    sendInvitationEmail: (data) => sendInvitationEmail(mailEnv, data),
  };
}

/** Default-Deps der produktiven App (siehe `app.ts`). */
export const runtimeDeps: ApiDeps = {
  resolveTenant: resolveTenantRuntime,
  createAuthForTenant: createAuthForTenantRuntime,
  getBrandingDeps: getBrandingDepsRuntime,
  getTeamDeps: getTeamDepsRuntime,
};
