import type { Tenant } from "@/lib/tenant/types";
import { resolveTenant as resolveFromRegistry } from "@/lib/tenant/resolve";
import { D1AuditRepository } from "@/server/auth/audit";
import { D1InvitationRepository } from "@/server/auth/invitations";
import { createKvNonceStore, type OAuthGatewayDeps } from "@/server/auth/oauth-gateway";
import { sendInvitationEmail, sendSupportTicketEmail } from "@/server/auth/resend";
import { D1SupportRepository } from "@/server/support/store";
import { createAuth } from "@/server/auth/runtime";
import { getAuthSecret } from "@/server/auth/secret";
import { D1TeamUserRepository } from "@/server/auth/team-users";
import { D1BrandingRepository, type BrandingDeps } from "@/server/branding/store";
import { D1ContentRepository, type ContentDeps } from "@/server/content/store";
import { getDbSafe } from "@/server/db/client";
import { D1LegalRepository, type LegalDeps } from "@/server/legal/store";
import { makeSendOwnerSetup } from "@/server/operator/onboarding";
import { D1OperatorRepository } from "@/server/operator/repository";
import { findStaleAnswers } from "@/server/answers/staleness";
import { D1SavedAnswersRepository } from "@/server/answers/store";
import { D1BillingRepository, type BillingDeps } from "@/server/billing/store";
import { makeCustomHostnameProvisioner } from "@/server/domains/provisioner";
import { D1DomainRepository } from "@/server/domains/store";
import { makeTxtChecker } from "@/server/domains/verify";
import {
  AI_GATEWAY_ID,
  GENERATION_MODEL,
  looksDegenerate,
  makeWorkersAiEmbeddings,
} from "@/server/ai/models";
import { answerQuestion, type AskPipelineDeps } from "@/server/rag/ask";
import type { ChatMessage } from "@/server/rag/generate";
import { translateArticle } from "@/server/content/translate";
import { changelogDoc, parseDocId, roadmapDoc } from "@/server/search/aux-docs";
import type { SourceKind } from "@/server/search/indexer";
import { rebuildTenantIndex, syncArticleIndex, toIndexable } from "@/server/search/sync";
import {
  makeTurnstileVerify,
  turnstileConfigFromEnv,
  type TurnstileVerdict,
} from "@/server/security/turnstile";
import { makeVisitorIdCodec, type VisitorIdCodec } from "@/server/security/visitor-id";
import { D1TenantRepository } from "@/server/tenant/repository";
import { resolveWithSourceStrict } from "@/server/tenant/resolve-tenant";
import type {
  ApiDeps,
  AnswersDeps,
  ArticleTranslator,
  AskRuntime,
  AuthInstance,
  ContentIndexer,
  DomainDeps,
  OperatorDeps,
  SettingsDeps,
  SupportDeps,
  TeamDeps,
} from "./context";
import type { RateLimiterBinding, RateLimiters } from "./rate-limit";

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
  // media (R2) getrennt nullable: ohne MEDIA-Binding bleiben Artikel-Ops
  // voll nutzbar, nur Bild-Upload/-Serving antworten 503/404 (content.ts).
  return { store: new D1ContentRepository(env.DB), media: env.MEDIA ?? null };
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

/** Gespeicherte KI-Antworten: Konto-Store + Staleness-Prüfung (nur DB nötig). */
async function getAnswersDepsRuntime(): Promise<AnswersDeps | null> {
  const env = await getEnvSafe();
  if (!env?.DB) return null;
  const db = env.DB;
  return {
    repo: new D1SavedAnswersRepository(db),
    findStale: (tenantId, answers) => findStaleAnswers({ DB: db }, tenantId, answers),
  };
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
/**
 * Gateway-Chat mit Degenerations-Schutz — GETEILT von Frage-Pipeline und
 * KI-Übersetzung. CACHE-POISONING-SCHUTZ (Live-Fund 2026-07-17): Das
 * fp8-fast-Modell degeneriert selten zu Token-Salat (U+FFFD); der AI-Gateway-
 * Cache würde die kaputte Antwort für die TTL festhalten. Degeneriert ⇒ EIN
 * Retry mit skipCache; bleibt es kaputt ⇒ Fehler (Routen → 502, es wird
 * NICHTS verbucht) statt Müll an den Nutzer.
 */
function makeGatewayChat(ai: Ai, opts: { maxTokens?: number } = {}) {
  return async (messages: ChatMessage[]): Promise<string> => {
    const runOnce = async (skipCache: boolean): Promise<string> => {
      const raw = (await ai.run(
        GENERATION_MODEL as Parameters<Ai["run"]>[0],
        // max_tokens: Workers-AI-Default (256) reicht für Antworten, aber
        // NICHT für Artikel-Übersetzungen — Aufrufer wie der Übersetzer
        // erhöhen das Budget explizit.
        { messages, ...(opts.maxTokens ? { max_tokens: opts.maxTokens } : {}) },
        { gateway: { id: AI_GATEWAY_ID, ...(skipCache ? { skipCache: true } : {}) } },
      )) as unknown;
      // Workers AI antwortet je nach Parametern in ZWEI Formen: nativ
      // ({response}) ODER OpenAI-kompatibel ({choices[0].message.content} —
      // Live-Fund 2026-07-17: mit max_tokens kommt das OpenAI-Format). Der
      // Remote-Binding-Proxy in `next dev` liefert zudem teils NICHT-plain
      // Objekte (Property-Zugriff schlägt fehl, obwohl stringify sie zeigt)
      // → über JSON normalisieren, DANN extrahieren.
      const norm = JSON.parse(JSON.stringify(raw ?? null)) as {
        response?: string;
        choices?: { message?: { content?: string } }[];
      } | null;
      // ACHTUNG (Live-Fund): das vLLM-Format liefert BEIDE Felder — `choices`
      // (mit dem Text) UND ein `response`-Feld, das ein OBJEKT sein kann.
      // `response` deshalb nur nehmen, wenn es wirklich ein String ist.
      const text =
        typeof norm?.response === "string" && norm.response.trim().length > 0
          ? norm.response
          : norm?.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.trim().length === 0) {
        console.error("[ai-chat] leere Antwort:", JSON.stringify(norm)?.slice(0, 300));
        throw new Error("generation: leere Modellantwort");
      }
      return text;
    };
    const first = await runOnce(false);
    if (!looksDegenerate(first)) return first;
    console.warn("[ai-chat] degenerierte Generierung — Retry mit skipCache");
    const second = await runOnce(true);
    if (looksDegenerate(second)) throw new Error("generation: degenerierte Modellantwort");
    return second;
  };
}

/** KI-Übersetzer (Mehrsprachigkeit): gleicher Gateway-Chat wie die Frage-Pipeline. */
async function getTranslatorRuntime(): Promise<ArticleTranslator | null> {
  const env = await getEnvSafe();
  if (!env?.AI) return null;
  const generate = makeGatewayChat(env.AI, { maxTokens: 4096 });
  return (input) => translateArticle(generate, input);
}

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
        .map((m) => {
          const meta = m.metadata as Record<string, unknown> | undefined;
          const kind = meta?.kind;
          return {
            docId: String(meta?.articleId ?? ""),
            // Bestands-Vektoren (vor aux-Quellen) tragen kein kind → article.
            kind: (kind === "roadmap" || kind === "changelog" ? kind : "article") as SourceKind,
            chunkIndex: Number(meta?.chunkIndex ?? -1),
            score: m.score,
          };
        })
        .filter((m) => m.docId.length > 0 && Number.isInteger(m.chunkIndex) && m.chunkIndex >= 0);
    },
    loadSources: async (tenantId, hits) => {
      // Nach Quellen-Art aufteilen; Pseudo-Ids tragen ihr Präfix (`rm:`/`cl:`).
      const articleIds = [...new Set(hits.filter((h) => h.kind === "article").map((h) => h.docId))];
      const roadmapIds = [
        ...new Set(
          hits.filter((h) => h.kind === "roadmap").map((h) => parseDocId(h.docId).rawId),
        ),
      ];
      const changelogIds = [
        ...new Set(
          hits.filter((h) => h.kind === "changelog").map((h) => parseDocId(h.docId).rawId),
        ),
      ];

      const inList = (n: number) => Array.from({ length: n }, () => "?").join(",");
      const [articles, roadmap, changelog] = await Promise.all([
        articleIds.length > 0
          ? db
              .prepare(
                `SELECT id, slug, title, body_json, images_json FROM articles
                  WHERE tenant_id = ? AND status = 'published' AND id IN (${inList(articleIds.length)})`,
              )
              .bind(tenantId, ...articleIds)
              .all<{ id: string; slug: string; title: string; body_json: string }>()
          : Promise.resolve({ results: [] as { id: string; slug: string; title: string; body_json: string }[] }),
        roadmapIds.length > 0
          ? db
              .prepare(
                `SELECT id, title, status FROM roadmap_items
                  WHERE tenant_id = ? AND id IN (${inList(roadmapIds.length)})`,
              )
              .bind(tenantId, ...roadmapIds)
              .all<{ id: string; title: string; status: string }>()
          : Promise.resolve({ results: [] as { id: string; title: string; status: string }[] }),
        changelogIds.length > 0
          ? db
              .prepare(
                `SELECT id, title, description FROM changelog_entries
                  WHERE tenant_id = ? AND id IN (${inList(changelogIds.length)})`,
              )
              .bind(tenantId, ...changelogIds)
              .all<{ id: string; title: string; description: string }>()
          : Promise.resolve({ results: [] as { id: string; title: string; description: string }[] }),
      ]);

      return [
        ...articles.results.map((r) => ({ ...toIndexable(r), kind: "article" as const })),
        ...roadmap.results.map((r) => ({ ...roadmapDoc(r), kind: "roadmap" as const })),
        ...changelog.results.map((r) => ({ ...changelogDoc(r), kind: "changelog" as const })),
      ];
    },
    generate: makeGatewayChat(env.AI),
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

/** Support-Flow: Tickets (D1) + Ticket-Mail (Resend, inert ohne Key). */
async function getSupportDepsRuntime(): Promise<SupportDeps | null> {
  const env = await getEnvSafe();
  const db = await getDbSafe();
  if (!db) return null;
  return {
    repo: new D1SupportRepository(db),
    // Ohne env/Key ist der Sender ein No-op (Muster Invitations/OTP).
    sendTicketMail: (data) => sendSupportTicketEmail({ RESEND_API_KEY: env?.RESEND_API_KEY }, data),
  };
}

/** Instanz-Einstellungen (SEO-Opt-out, Support-E-Mail) — D1TenantRepository. */
async function getSettingsDepsRuntime(): Promise<SettingsDeps | null> {
  const db = await getDbSafe();
  if (!db) return null;
  const repo = new D1TenantRepository(db);
  return {
    setSeoIndexable: (tenantId, indexable) => repo.setSeoIndexable(tenantId, indexable),
    setSupportEmail: (tenantId, email) => repo.setSupportEmail(tenantId, email),
  };
}

/**
 * IP-Rate-Limiter, lazy an die Env gebunden (Bindings existieren erst pro
 * Request/Isolate, runtimeDeps ist aber modul-statisch). Fehlt Env/Binding
 * (dev ohne Wrangler, Tests) ⇒ success=true (fail-open, s. rate-limit.ts).
 */
function makeLazyLimiter(
  pick: (env: CloudflareEnv) => RateLimiterBinding | undefined,
): RateLimiterBinding {
  return {
    async limit(options: { key: string }): Promise<{ success: boolean }> {
      const env = await getEnvSafe();
      const binding = env ? pick(env) : undefined;
      return binding ? binding.limit(options) : { success: true };
    },
  };
}

const rateLimitersRuntime: RateLimiters = {
  ask: makeLazyLimiter((env) => env.RL_ASK),
  events: makeLazyLimiter((env) => env.RL_EVENTS),
  sensitive: makeLazyLimiter((env) => env.RL_SENSITIVE),
};

async function visitorSecret(): Promise<string | null> {
  const env = await getEnvSafe();
  if (!env) return null;
  try {
    return await getAuthSecret(env);
  } catch {
    return null;
  }
}

/**
 * Besucher-ID-Codec, lazy an AUTH_SECRET gebunden (String ODER Secrets-Store,
 * wie bei createAuth). Ohne Secret (dev ohne Bindings — dort gibt es kein
 * Billing) fallen die IDs auf unsignierte UUIDs zurück, identisch zur
 * codec-losen Semantik in events.ts.
 */
const visitorCodecRuntime: VisitorIdCodec = {
  async issue(tenantId: string): Promise<string> {
    const secret = await visitorSecret();
    return secret ? makeVisitorIdCodec(secret).issue(tenantId) : crypto.randomUUID();
  },
  async verify(tenantId: string, value: string): Promise<string | null> {
    const secret = await visitorSecret();
    if (secret) return makeVisitorIdCodec(secret).verify(tenantId, value);
    return /^[0-9a-f-]{36}$/.test(value) ? value : null;
  },
};

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
  getTranslator: getTranslatorRuntime,
  getSettingsDeps: getSettingsDepsRuntime,
  getSupportDeps: getSupportDepsRuntime,
  getAnswersDeps: getAnswersDepsRuntime,
  rateLimiters: rateLimitersRuntime,
  visitorCodec: visitorCodecRuntime,
};
