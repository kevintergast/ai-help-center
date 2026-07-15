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
import { D1BillingRepository, type BillingDeps } from "@/server/billing/store";
import { makeCustomHostnameProvisioner } from "@/server/domains/provisioner";
import { D1DomainRepository } from "@/server/domains/store";
import { makeTxtChecker } from "@/server/domains/verify";
import { AI_GATEWAY_ID, GENERATION_MODEL, makeWorkersAiEmbeddings } from "@/server/ai/models";
import { answerQuestion, type AskPipelineDeps } from "@/server/rag/ask";
import { rebuildTenantIndex, syncArticleIndex, toIndexable } from "@/server/search/sync";
import {
  makeTurnstileVerify,
  turnstileConfigFromEnv,
  type TurnstileVerdict,
} from "@/server/security/turnstile";
import { D1TenantRepository } from "@/server/tenant/repository";
import { resolveWithSourceStrict } from "@/server/tenant/resolve-tenant";
import type {
  ApiDeps,
  AskRuntime,
  AuthInstance,
  ContentIndexer,
  DomainDeps,
  OperatorDeps,
  TeamDeps,
} from "./context";

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

/**
 * Metering/Billing (Infra-Plan Schritt 3): D1-Repo auf den 0009-Tabellen.
 * Ohne D1-Bindung → `null` → Event-Ingestion No-op, Freeze-Gate inaktiv
 * (Begründung: api/events.ts bzw. billing/enforcement.ts).
 */
async function getBillingDepsRuntime(): Promise<BillingDeps | null> {
  const env = await getEnvSafe();
  if (!env?.DB) return null;
  return { repo: new D1BillingRepository(env.DB) };
}

/**
 * Custom-Domain-Flow (Infra-Plan Schritt 5): tenant_domain auf D1, TXT-Check
 * via DNS-over-HTTPS (1.1.1.1), Cloudflare-for-SaaS-Provisioner (inert ohne
 * CF_SAAS_API_TOKEN/CF_ZONE_ID — Begründung: domains/provisioner.ts).
 */
async function getDomainDepsRuntime(): Promise<DomainDeps | null> {
  const env = await getEnvSafe();
  if (!env?.DB) return null;
  return {
    repo: new D1DomainRepository(env.DB),
    checkTxt: makeTxtChecker(),
    provision: makeCustomHostnameProvisioner(
      env as CloudflareEnv & { CF_SAAS_API_TOKEN?: string; CF_ZONE_ID?: string },
    ),
  };
}

/**
 * Such-/RAG-Index (Infra-Plan Schritt 6): Vectorize + Workers AI (bge-m3 via
 * AI Gateway) + D1-Buchführung (0010). Fehlt eine Binding → `null` → Content-
 * Ops laufen OHNE Indexierung (Best-Effort; Nachziehen via /reindex).
 *
 * AUFRUFWEG-WEICHE: Im DEPLOYTEN Worker (NODE_ENV=production) wandert der
 * Sync als Nachricht in die EMBED_QUEUE (Retries, Latenz raus aus dem
 * Request). In `next dev` läuft dort KEIN Queue-Consumer → direkter Pfad via
 * `ctx.waitUntil` (bzw. inline ohne Worker-Kontext). Beide Wege nutzen
 * DIESELBE Logik (search/sync.ts) — der Consumer lebt in worker.ts.
 */
async function getContentIndexerRuntime(): Promise<ContentIndexer | null> {
  const env = await getEnvSafe();
  if (!env?.DB || !env.VECTORIZE || !env.AI) return null;

  const runDirect = async (tenantId: string, articleId: string) => {
    const work = syncArticleIndex(env, tenantId, articleId).catch((err) =>
      console.error("[search-index] sync fehlgeschlagen:", err),
    );
    try {
      const { getCloudflareContext } = await import("@opennextjs/cloudflare");
      const ctx = (getCloudflareContext() as { ctx?: { waitUntil(p: Promise<unknown>): void } }).ctx;
      if (ctx?.waitUntil) {
        ctx.waitUntil(work);
        return;
      }
    } catch {
      /* kein Worker-Kontext → inline */
    }
    await work;
  };

  return {
    async onContentChange(tenantId, articleId) {
      if (env.EMBED_QUEUE && process.env.NODE_ENV === "production") {
        await env.EMBED_QUEUE.send({ tenantId, articleId });
        return;
      }
      await runDirect(tenantId, articleId);
    },
    // Backfill bewusst SYNCHRON (Owner will das Ergebnis sehen; unveränderte
    // Chunks kosten dank Hash-Vergleich nichts).
    rebuildTenant: (tenantId) => rebuildTenantIndex(env, tenantId),
  };
}

/**
 * Dynamischer KI-Artikel (RAG-Kern): echte Pipeline auf Workers AI (Embedding +
 * Generierung, beides via AI Gateway `hallofhelp`) + Vectorize (Tenant-
 * Namespace) + D1 (published-Artikel als Kontext-Quelle, Metering). Fehlt eine
 * Binding → `null` → POST /ask antwortet 503 fail-closed.
 */
async function getAskDepsRuntime(): Promise<AskRuntime | null> {
  const env = await getEnvSafe();
  if (!env?.DB || !env.VECTORIZE || !env.AI) return null;
  const db = env.DB;
  const embeddings = makeWorkersAiEmbeddings(env.AI);

  const deps: AskPipelineDeps = {
    embed: async (text) => (await embeddings.embed([text]))[0],
    queryVectors: async (tenantId, vector) => {
      const res = await env.VECTORIZE.query(vector, {
        topK: 10,
        namespace: tenantId,
        returnMetadata: "all",
      });
      return res.matches
        .map((m) => ({
          articleId: String((m.metadata as Record<string, unknown> | undefined)?.articleId ?? ""),
          chunkIndex: Number(
            (m.metadata as Record<string, unknown> | undefined)?.chunkIndex ?? -1,
          ),
          score: m.score,
        }))
        .filter((m) => m.articleId.length > 0 && Number.isInteger(m.chunkIndex) && m.chunkIndex >= 0);
    },
    loadPublishedArticles: async (tenantId, ids) => {
      if (ids.length === 0) return [];
      const placeholders = ids.map(() => "?").join(",");
      const rows = await db
        .prepare(
          `SELECT id, slug, title, body_json FROM articles
            WHERE tenant_id = ? AND status = 'published' AND id IN (${placeholders})`,
        )
        .bind(tenantId, ...ids)
        .all<{ id: string; slug: string; title: string; body_json: string }>();
      return rows.results.map(toIndexable);
    },
    generate: async (messages) => {
      const res = (await env.AI.run(
        GENERATION_MODEL as Parameters<Ai["run"]>[0],
        { messages },
        { gateway: { id: AI_GATEWAY_ID } },
      )) as { response?: string };
      const text = res?.response;
      if (typeof text !== "string" || text.trim().length === 0) {
        throw new Error("generation: leere Modellantwort");
      }
      return text;
    },
    billing: new D1BillingRepository(db),
  };

  return { answer: (input) => answerQuestion(deps, input) };
}

/**
 * Turnstile-Prüfung der Tenant-Erstellung (Infra-Plan Schritt 2). Konfiguration
 * wird PRO AUFRUF aus den Bindings gelesen (kein Modul-Cache — Workers können
 * Env zwischen Requests nicht wechseln, aber `next dev` schon). Ohne
 * Cloudflare-Kontext gilt die dev-Semantik (kein Secret → „ok", siehe
 * security/turnstile.ts — identisch zur Registry-Fallback-Philosophie oben).
 */
async function verifyTurnstileRuntime(
  token: string | null,
  remoteIp?: string | null,
): Promise<TurnstileVerdict> {
  const env = (await getEnvSafe()) ?? {};
  const verify = makeTurnstileVerify(await turnstileConfigFromEnv(env));
  return verify(token, remoteIp);
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
  verifyTurnstile: verifyTurnstileRuntime,
  getBillingDeps: getBillingDepsRuntime,
  getDomainDeps: getDomainDepsRuntime,
  getContentIndexer: getContentIndexerRuntime,
  getAskDeps: getAskDepsRuntime,
};
