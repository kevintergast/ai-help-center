import type { Tenant } from "@/lib/tenant/types";
import { resolveTenant as resolveFromRegistry } from "@/lib/tenant/resolve";
import { D1AuditRepository } from "@/server/auth/audit";
import { D1InvitationRepository } from "@/server/auth/invitations";
import { createKvNonceStore, type OAuthGatewayDeps } from "@/server/auth/oauth-gateway";
import { sendInvitationEmail } from "@/server/auth/resend";
import { createAuth } from "@/server/auth/runtime";
import { getAuthSecret } from "@/server/auth/secret";
import { D1TeamUserRepository } from "@/server/auth/team-users";
import { D1BrandingRepository, type BrandingDeps } from "@/server/branding/store";
import { D1ContentRepository, type ContentDeps } from "@/server/content/store";
import { getDbSafe } from "@/server/db/client";
import { D1LegalRepository, type LegalDeps } from "@/server/legal/store";
import { makeSendOwnerSetup } from "@/server/operator/onboarding";
import { D1OperatorRepository } from "@/server/operator/repository";
import { D1TenantRepository } from "@/server/tenant/repository";
import { resolveWithSourceStrict } from "@/server/tenant/resolve-tenant";
import type { ApiDeps, AuthInstance, OperatorDeps, TeamDeps } from "./context";

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

/**
 * Legal-Docs-Persistenz (Design h): D1-Repo auf `tenant_legal_docs`. Ohne
 * D1-Bindung (Unit-Tests, `next dev` ohne Wrangler) → `null` → die Legal-Routen
 * antworten 503 fail-closed statt gegen einen Fake-Speicher zu arbeiten.
 */
async function getLegalDepsRuntime(): Promise<LegalDeps | null> {
  const env = await getEnvSafe();
  if (!env?.DB) return null;
  return { repo: new D1LegalRepository(env.DB) };
}

/**
 * Content-Persistenz (Punkt 2): D1-Repo auf `articles`/`article_versions`/
 * `roadmap_items`/`changelog_entries`. Ohne D1-Bindung (Unit-Tests, `next dev`
 * ohne Wrangler) → `null` → die Content-Admin-Routen antworten 503 fail-closed.
 */
async function getContentDepsRuntime(): Promise<ContentDeps | null> {
  const env = await getEnvSafe();
  if (!env?.DB) return null;
  return { store: new D1ContentRepository(env.DB) };
}

/**
 * Operator-Provisioning (Punkt 4b): Control-Plane-Repo auf `tenants`/`auth_user`/
 * `operator_help_centers` + Owner-Setup-Versand über den Reset-Mechanismus.
 * Ohne D1-Bindung (Unit-Tests, `next dev` ohne Wrangler) → `null` → die
 * Operator-Routen antworten 503 fail-closed.
 */
async function getOperatorDepsRuntime(): Promise<OperatorDeps | null> {
  const env = await getEnvSafe();
  if (!env?.DB) return null;
  const mailEnv = env as CloudflareEnv & { RESEND_API_KEY?: string };
  return {
    repo: new D1OperatorRepository(env.DB),
    sendOwnerSetup: makeSendOwnerSetup(mailEnv),
  };
}

/**
 * OAuth-Gateway-Infrastruktur (Phase E): rohes AUTH_SECRET (HKDF-Basis) +
 * KV-basierter, tenant-präfigierter Single-use-Nonce-Store (`CACHE`). Fehlt die
 * Cloudflare-Umgebung (Unit-Tests, `next dev` ohne Wrangler), ist der Gateway
 * `null` → der Gateway-Host antwortet 503. Tenant-Hosts sind davon unberührt.
 */
function buildOAuthGatewayDeps(): OAuthGatewayDeps {
  return {
    getSecret: async () => {
      const env = await getEnvSafe();
      if (!env) throw new Error("oauth-gateway: keine Cloudflare-Umgebung (AUTH_SECRET fehlt).");
      return getAuthSecret(env);
    },
    // Lazy: der Nonce-Store bindet `CACHE` erst beim ersten Zugriff (die
    // Bindung existiert nur im Worker-Kontext).
    nonceStore: {
      issue: async (t, n) => {
        const env = await getEnvSafe();
        if (!env?.CACHE) throw new Error("oauth-gateway: CACHE-Binding fehlt.");
        await createKvNonceStore(env.CACHE).issue(t, n);
      },
      consume: async (t, n) => {
        const env = await getEnvSafe();
        if (!env?.CACHE) return false; // fail-closed: ohne Store gilt jede Nonce als verbraucht.
        return createKvNonceStore(env.CACHE).consume(t, n);
      },
    },
    // Tenant-Claim-Konsistenz (§3): den (signatur-authentifizierten) initiierenden
    // Origin über DENSELBEN strikten Resolver zur Tenant-id auflösen, damit der
    // Gateway `state.tid` gegen den Origin-Tenant prüfen kann. Der Origin stammt
    // aus dem signierten state (kein Host-Header-Vertrauen).
    resolveTenantIdByOrigin: async (origin) => {
      let host: string;
      try {
        host = new URL(origin).host;
      } catch {
        return null;
      }
      const tenant = await resolveTenantRuntime(host);
      return tenant?.id ?? null;
    },
  };
}

/** Default-Deps der produktiven App (siehe `app.ts`). */
export const runtimeDeps: ApiDeps = {
  resolveTenant: resolveTenantRuntime,
  createAuthForTenant: createAuthForTenantRuntime,
  getBrandingDeps: getBrandingDepsRuntime,
  getTeamDeps: getTeamDepsRuntime,
  getLegalDeps: getLegalDepsRuntime,
  getContentDeps: getContentDepsRuntime,
  getOperatorDeps: getOperatorDepsRuntime,
  oauthGateway: buildOAuthGatewayDeps(),
};
