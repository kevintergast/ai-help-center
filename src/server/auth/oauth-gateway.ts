import { deriveTenantKey } from "./crypto";

/**
 * PHASE E — OAUTH-GATEWAY (Design §c-3, A-3/T-5).
 *
 * PROBLEM: Google/Microsoft erlauben pro OAuth-Client nur EINE registrierte,
 * exakt-matchende `redirect_uri` — Wildcard-Subdomains (`*.hallofhelp.com`)
 * sind NICHT zulässig. Ein Multi-Tenant-SaaS mit einer Origin pro Tenant kann
 * den Callback deshalb nicht direkt auf `<slug>.hallofhelp.com` empfangen.
 *
 * LÖSUNG: EIN zentraler, tenant-freier Gateway-Host `auth.hallofhelp.com` ist
 * die einzige registrierte `redirect_uri`. Der Provider ruft IMMER dort zurück.
 * Der Gateway löst den Tenant NICHT über den Host auf (der Host ist neutral),
 * sondern AUSSCHLIESSLICH aus einem signierten `state`, den der Tenant-Host beim
 * Sign-in-Start erzeugt hat, und leitet den Callback per 302 zurück an die
 * initiierende Tenant-Origin, wo better-auth mit seiner dort gesetzten
 * state-Cookie den Code-Exchange abschließt. KEIN user/account-Insert am
 * Gateway.
 *
 * VERIFIZIERTE better-auth-Mechanik (v1.6.23), auf der das aufsetzt:
 *  - `createAuthorizationURL` UND `validateAuthorizationCode` setzen die
 *    `redirect_uri` als `options.redirectURI || redirectURI` — d. h. die in der
 *    Provider-Config gesetzte `redirectURI` überschreibt konsistent SOWOHL den
 *    Authorization-Request ALS AUCH den Token-Exchange (core/oauth2/*.mjs).
 *    Darum zeigt `socialProviders.{google,microsoft}.redirectURI` auf den
 *    Gateway-Host — Provider und better-auth bleiben deckungsgleich.
 *  - better-auths eigener `state` ist ein zufälliger 32-Zeichen-Wert; die
 *    eigentlichen Flow-Daten (codeVerifier, callbackURL, Nonce) liegen
 *    tenant-seitig in `auth_verification` + einer signierten `state`-Cookie
 *    (state.mjs → `generateGenericState`). Dieser innere state ist der
 *    CSRF-Anker und bleibt unangetastet — wir wickeln ihn nur in einen äußeren,
 *    signierten Umschlag, den der Gateway wieder auspackt.
 *
 * DIESES MODUL liefert die reine, testbare Krypto-/Routing-Mechanik:
 *  - `signState`/`verifyState`: HMAC über `HKDF(AUTH_SECRET, tenantId)`,
 *    single-use Nonce, Origin-Allowlist (Open-Redirect-Schutz).
 *  - `handleGatewayCallback`: 302 auf die Tenant-Origin mit erhaltener Query,
 *    ersetzt nur den äußeren state durch den inneren better-auth-state.
 *  - `wrapAuthorizationURL`: erzeugt aus better-auths Authorization-URL die
 *    gewrappte URL (Sign-in-Start auf dem Tenant-Host).
 */

/** Zentraler Gateway-Host (die EINZIGE bei Google/Microsoft registrierte redirect_uri-Origin). */
export const OAUTH_GATEWAY_HOST = "auth.hallofhelp.com";
export const OAUTH_GATEWAY_ORIGIN = `https://${OAUTH_GATEWAY_HOST}`;

/** Auth-Mount-Basispfad (identisch zu AUTH_BASE_PATH in auth.ts; hier dupliziert, um Import-Zyklen zu vermeiden). */
const GATEWAY_BASE_PATH = "/api/v1/auth";

/** Von uns unterstützte Provider (bestimmt die registrierte redirect_uri je Provider). */
export const SUPPORTED_SOCIAL_PROVIDERS = ["google", "microsoft"] as const;
export type SocialProviderId = (typeof SUPPORTED_SOCIAL_PROVIDERS)[number];

/** Die je Provider bei Google/Microsoft zu registrierende (Gateway-)redirect_uri. */
export function gatewayRedirectURI(provider: SocialProviderId): string {
  return `${OAUTH_GATEWAY_ORIGIN}${GATEWAY_BASE_PATH}/callback/${provider}`;
}

/** Ist der (bereits port-bereinigte) Host der Gateway-Host? */
export function isGatewayHost(host: string | null | undefined): boolean {
  return (host ?? "").split(":")[0].toLowerCase() === OAUTH_GATEWAY_HOST;
}

// --------------------------------------------------------------------------
// Origin-Allowlist (Open-Redirect-Schutz)
// --------------------------------------------------------------------------

/**
 * Erlaubte initiierende Origins: NUR `https://<slug>.hallofhelp.com`, wobei
 * `<slug>` eine gültige (nicht reservierte) Subdomain ist. Damit kann der
 * Gateway NIE auf ein beliebiges Ziel (offener Redirect) weiterleiten — selbst
 * wenn ein Angreifer einen gültig signierten state hätte, müsste die Origin
 * diesem Muster genügen. `auth`/`www`/`api` sind ausgeschlossen.
 */
const BASE_DOMAIN = "hallofhelp.com";
const ALLOWED_ORIGIN_RE = /^https:\/\/([a-z0-9](?:[a-z0-9-]*[a-z0-9])?)\.hallofhelp\.com$/;
const RESERVED_ORIGIN_SLUGS: ReadonlySet<string> = new Set(["www", "auth", "api"]);

export function isAllowedInitiatingOrigin(origin: string): boolean {
  const m = ALLOWED_ORIGIN_RE.exec(origin);
  if (!m) return false;
  return !RESERVED_ORIGIN_SLUGS.has(m[1]);
}

/**
 * Kanonische initiierende Tenant-Origin für einen Slug: IMMER
 * `https://<slug>.hallofhelp.com` (deckungsgleich mit `tenantBaseURL` in
 * runtime.ts — bewusst NICHT die unverifizierte Custom-Domain). Der Gateway
 * leitet den Callback später an genau diese Origin zurück; dort liegen die
 * better-auth-state-Cookie + verification-Zeile (host-scoped), sodass der
 * Code-Exchange tenant-seitig sauber abschließt.
 */
export function tenantInitiatingOrigin(slug: string): string {
  return `https://${slug}.${BASE_DOMAIN}`;
}

// --------------------------------------------------------------------------
// Single-use Nonce-Store (Replay-Schutz)
// --------------------------------------------------------------------------

/**
 * Single-use-Nonce-Speicher. Beim Sign-in-Start wird eine Nonce `issue`d, beim
 * Gateway-Callback `consume`d (verbrannt). `consume` liefert `true` GENAU beim
 * ERSTEN Einlösen einer ausgestellten Nonce, danach `false` (Replay).
 * Tenant-präfigiert (D10), damit Nonces zweier Tenants nie kollidieren.
 */
export interface NonceStore {
  issue(tenantId: string, nonce: string): Promise<void>;
  consume(tenantId: string, nonce: string): Promise<boolean>;
}

/** In-Memory-Store (Tests / Single-Isolate-Dev). NICHT für Multi-Isolate-Prod. */
export function createMemoryNonceStore(): NonceStore {
  const live = new Set<string>();
  const key = (t: string, n: string) => `${t}:${n}`;
  return {
    issue: async (t, n) => {
      live.add(key(t, n));
    },
    consume: async (t, n) => live.delete(key(t, n)),
  };
}

/**
 * KV-basierter Store (Cloudflare `CACHE`), tenant-präfigiert, mit TTL. `consume`
 * ist read-then-delete: nicht strikt atomar über Isolates, aber der innere
 * better-auth-state (in `auth_verification`, single-use beim `parseState`)
 * bleibt die harte Replay-Grenze — dieser Store ist Defense-in-Depth am Gateway.
 */
export function createKvNonceStore(kv: KVNamespace, ttlSeconds = 600): NonceStore {
  const key = (t: string, n: string) => `oauth-nonce:${t}:${n}`;
  return {
    issue: async (t, n) => {
      await kv.put(key(t, n), "1", { expirationTtl: ttlSeconds });
    },
    consume: async (t, n) => {
      const k = key(t, n);
      const hit = await kv.get(k);
      if (hit === null) return false;
      await kv.delete(k);
      return true;
    },
  };
}

// --------------------------------------------------------------------------
// state sign / verify
// --------------------------------------------------------------------------

const STATE_VERSION = 1;
/** Gültigkeitsfenster des äußeren state (muss den OAuth-Roundtrip abdecken). */
export const DEFAULT_STATE_TTL_MS = 600_000; // 10 min

interface StatePayload {
  /** Schema-Version (Vorwärtskompatibilität). */
  v: number;
  /** Tenant-ID (interne id, z. B. `t_a`) — wählt den HKDF-Schlüssel. */
  tid: string;
  /** Initiierende Tenant-Origin (`https://<slug>.hallofhelp.com`). */
  o: string;
  /** Single-use Nonce (Replay-Schutz). */
  n: string;
  /** Ablauf (Unix-ms). */
  exp: number;
  /** Innerer better-auth-state (zufälliger 32-Zeichen-Wert) — CSRF-Anker. */
  s: string;
}

export interface SignStateParams {
  tenantId: string;
  initiatingOrigin: string;
  /** Innerer better-auth-state, den der Gateway später wieder einsetzt. */
  innerState: string;
  nonce: string;
  ttlMs?: number;
  /** Test-Hook: fixe „jetzt"-Zeit. */
  now?: number;
}

function b64urlEncode(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(s: string): Uint8Array {
  const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function hmacSign(perTenantKey: string, message: string): Promise<Uint8Array> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(perTenantKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
  return new Uint8Array(sig);
}

/** Konstantzeit-Vergleich zweier Byte-Arrays. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * Signiert den äußeren state: `base64url(payload).base64url(HMAC)`.
 * Der HMAC-Schlüssel ist `HKDF(AUTH_SECRET, tenantId)` (D8) — ein state, der für
 * Tenant A signiert wurde, verifiziert unter B NICHT (anderer abgeleiteter Key).
 */
export async function signState(secret: string, params: SignStateParams): Promise<string> {
  const now = params.now ?? Date.now();
  const payload: StatePayload = {
    v: STATE_VERSION,
    tid: params.tenantId,
    o: params.initiatingOrigin,
    n: params.nonce,
    exp: now + (params.ttlMs ?? DEFAULT_STATE_TTL_MS),
    s: params.innerState,
  };
  const payloadB64 = b64urlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const perTenantKey = await deriveTenantKey(secret, params.tenantId);
  const sig = await hmacSign(perTenantKey, payloadB64);
  return `${payloadB64}.${b64urlEncode(sig)}`;
}

export type VerifyStateResult =
  | { ok: true; tenantId: string; initiatingOrigin: string; innerState: string }
  | { ok: false; reason: VerifyStateReason };

export type VerifyStateReason =
  | "malformed"
  | "bad_signature"
  | "expired"
  | "foreign_origin"
  | "replay";

export interface VerifyStateOptions {
  nonceStore: NonceStore;
  /** Origin-Allowlist (Default: `isAllowedInitiatingOrigin`). */
  isAllowedOrigin?: (origin: string) => boolean;
  now?: number;
}

/**
 * Verifiziert den äußeren state (fail-closed). Reihenfolge bewusst:
 * Signatur (authentifiziert `tid`/`o`/`s`) VOR Ablauf/Origin/Nonce, damit
 * un-authentifizierte Felder nie einen Seiteneffekt (Nonce-Verbrauch) auslösen.
 * Der `tid` im (noch nicht verifizierten) Payload wählt nur den HKDF-Schlüssel
 * — analog zum `kid` eines JWT; ein Angreifer kann ohne den per-Tenant-Key
 * keine gültige Signatur erzeugen, also ist `tid` nach bestandener Signatur echt.
 */
export async function verifyState(
  secret: string,
  token: string,
  opts: VerifyStateOptions,
): Promise<VerifyStateResult> {
  const now = opts.now ?? Date.now();
  const isAllowedOrigin = opts.isAllowedOrigin ?? isAllowedInitiatingOrigin;

  const dot = token.indexOf(".");
  if (dot <= 0 || dot === token.length - 1) return { ok: false, reason: "malformed" };
  const payloadB64 = token.slice(0, dot);
  const sigB64 = token.slice(dot + 1);

  let payload: StatePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(b64urlDecode(payloadB64)));
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (
    payload?.v !== STATE_VERSION ||
    typeof payload.tid !== "string" ||
    typeof payload.o !== "string" ||
    typeof payload.n !== "string" ||
    typeof payload.exp !== "number" ||
    typeof payload.s !== "string"
  ) {
    return { ok: false, reason: "malformed" };
  }

  // (1) Signatur — authentifiziert den gesamten Payload.
  const perTenantKey = await deriveTenantKey(secret, payload.tid);
  const expected = await hmacSign(perTenantKey, payloadB64);
  let provided: Uint8Array;
  try {
    provided = b64urlDecode(sigB64);
  } catch {
    return { ok: false, reason: "malformed" };
  }
  if (!timingSafeEqual(provided, expected)) return { ok: false, reason: "bad_signature" };

  // (2) Ablauf.
  if (now > payload.exp) return { ok: false, reason: "expired" };

  // (3) Origin-Allowlist (Open-Redirect-Schutz).
  if (!isAllowedOrigin(payload.o)) return { ok: false, reason: "foreign_origin" };

  // (4) Single-use Nonce (Replay). Zuletzt: nur nach allen anderen Checks
  //     verbrennen, damit ein abgelehnter state die Nonce nicht konsumiert.
  const fresh = await opts.nonceStore.consume(payload.tid, payload.n);
  if (!fresh) return { ok: false, reason: "replay" };

  return {
    ok: true,
    tenantId: payload.tid,
    initiatingOrigin: payload.o,
    innerState: payload.s,
  };
}

// --------------------------------------------------------------------------
// Gateway-Callback (302 → Tenant-Origin)
// --------------------------------------------------------------------------

export interface OAuthGatewayDeps {
  /** Liefert das rohe AUTH_SECRET (HKDF-Basis). */
  getSecret(): Promise<string>;
  nonceStore: NonceStore;
  isAllowedOrigin?: (origin: string) => boolean;
  /**
   * OPTIONAL (Design §3 / §c-3, Tenant-Claim-Konsistenz): löst die (bereits
   * signatur-authentifizierte) `initiatingOrigin` zur zugehörigen Tenant-`id`
   * auf. Ist er gesetzt, prüft der Gateway, dass der im `state` eingebettete
   * `tid` (der HKDF-Schlüsselwähler) mit dem aus der Origin aufgelösten Tenant
   * ÜBEREINSTIMMT — sonst harter 403 (`tenant_origin_mismatch`) + Audit-Log.
   * Damit können der Schlüsselwahl- und der Ausführungs-Tenant nicht auseinander
   * driften. Der Wert kommt aus dem SIGNIERTEN state (nicht aus dem Host-Header),
   * die "Tenant nur aus verifiziertem state"-Invariante bleibt gewahrt.
   * Fehlt der Resolver (reine Krypto-/Routing-Unit-Tests), entfällt die Prüfung.
   */
  resolveTenantIdByOrigin?: (origin: string) => Promise<string | null>;
}

/** HTTP-Status je Ablehnungsgrund (4xx, KEIN Redirect, KEIN DB-Insert). */
const REJECT_STATUS: Record<VerifyStateReason, number> = {
  malformed: 400,
  bad_signature: 400,
  expired: 400,
  foreign_origin: 403,
  replay: 403,
};

/**
 * Verarbeitet den Provider-Callback auf dem GATEWAY-Host.
 *
 * Ablauf: state aus der Query lesen → verifizieren → 302 an
 * `<initiatingOrigin>/api/v1/auth/callback/{provider}?<originalQuery, state:=innerState>`.
 * Der GANZE übrige Query-String (v. a. `code`) bleibt erhalten; NUR der äußere
 * state wird durch den inneren better-auth-state ersetzt. Am Gateway passiert
 * KEIN Code-Exchange und KEIN DB-Schreibzugriff — der Exchange läuft erst
 * tenant-seitig (dort liegt die state-Cookie).
 *
 * @param rawRequest der eingehende Callback-Request (GET auf dem Gateway-Host)
 * @param provider   Provider-Segment aus dem Pfad (`google`/`microsoft`)
 */
export async function handleGatewayCallback(
  rawRequest: Request,
  provider: string,
  deps: OAuthGatewayDeps,
): Promise<Response> {
  if (!(SUPPORTED_SOCIAL_PROVIDERS as readonly string[]).includes(provider)) {
    return jsonError("unsupported_provider", 400);
  }

  const url = new URL(rawRequest.url);
  const state = url.searchParams.get("state");
  if (!state) return jsonError("missing_state", 400);

  const secret = await deps.getSecret();
  const result = await verifyState(secret, state, {
    nonceStore: deps.nonceStore,
    isAllowedOrigin: deps.isAllowedOrigin,
  });
  if (!result.ok) return jsonError(`invalid_state:${result.reason}`, REJECT_STATUS[result.reason]);

  // Tenant-Claim-Konsistenz (Design §3): der im state eingebettete `tid`
  // (HKDF-Schlüsselwähler) MUSS zum Tenant der initiierenden Origin passen.
  // Beide sind signatur-authentifiziert, driften also extern nicht auseinander
  // (Defense-in-Depth: fängt eine fehlerhafte/wiederverwendete Ausstellung ab).
  // Der `initiatingOrigin` stammt aus dem verifizierten state, NICHT aus dem
  // Host-Header — die "Tenant nur aus verifiziertem state"-Invariante bleibt.
  if (deps.resolveTenantIdByOrigin) {
    const originTenantId = await deps.resolveTenantIdByOrigin(result.initiatingOrigin).catch(() => null);
    if (originTenantId !== result.tenantId) {
      // account.link-attempt-blocked (§f): der tenant-scopede Audit-Eintrag ist
      // tenant-seitig zu Hause; der tenant-freie Gateway hat hier keine
      // Tenant-DB — daher strukturierte Log-Zeile + harter Reject (das
      // Sicherheits-Control). Persistenz im auth_audit_log erfolgt nicht am
      // Gateway (bewusst kein DB-Zugriff, §c-3).
      console.warn(
        "[oauth-gateway] account.link-attempt-blocked: tenant_origin_mismatch",
        JSON.stringify({
          claimedTenantId: result.tenantId,
          initiatingOrigin: result.initiatingOrigin,
          resolvedTenantId: originTenantId,
        }),
      );
      return jsonError("invalid_state:tenant_origin_mismatch", 403);
    }
  }

  // Query 1:1 übernehmen, nur den state gegen den inneren better-auth-state tauschen.
  const forwarded = new URLSearchParams(url.searchParams);
  forwarded.set("state", result.innerState);
  const target = `${result.initiatingOrigin}${GATEWAY_BASE_PATH}/callback/${provider}?${forwarded.toString()}`;

  return new Response(null, { status: 302, headers: { location: target } });
}

function jsonError(error: string, status: number): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { "content-type": "application/json" },
  });
}

// --------------------------------------------------------------------------
// Sign-in-Start: better-auth-Authorization-URL in den Gateway-Umschlag wickeln
// --------------------------------------------------------------------------

export interface WrapAuthorizationURLParams {
  secret: string;
  tenantId: string;
  initiatingOrigin: string;
  nonceStore: NonceStore;
  ttlMs?: number;
  /** Test-Hooks. */
  nonce?: string;
  now?: number;
}

/**
 * Nimmt die von better-auth erzeugte Authorization-URL (deren `redirect_uri`
 * bereits auf den Gateway-Host zeigt) und ersetzt ihren `state`-Query-Parameter
 * durch den signierten Gateway-Umschlag, der den inneren state trägt. Die dabei
 * verwendete Nonce wird im Store ausgestellt (single-use).
 *
 * WICHTIG: better-auths eigener state + die tenant-seitige state-Cookie +
 * `auth_verification`-Zeile bleiben unverändert — der CSRF-/State-Schutz wird
 * NICHT ausgehebelt, nur um einen authentifizierten Tenant-Routing-Umschlag
 * ergänzt. Der Gateway packt ihn wieder aus, better-auth sieht am Tenant-Host
 * exakt seinen ursprünglichen state.
 *
 * @returns die gewrappte Authorization-URL (String), zur Weiterleitung des Browsers.
 */
export async function wrapAuthorizationURL(
  authorizationURL: string,
  params: WrapAuthorizationURLParams,
): Promise<string> {
  const url = new URL(authorizationURL);
  const innerState = url.searchParams.get("state");
  if (!innerState) throw new Error("wrapAuthorizationURL: authorization URL has no state param");

  const nonce = params.nonce ?? crypto.randomUUID();
  await params.nonceStore.issue(params.tenantId, nonce);

  const wrapped = await signState(params.secret, {
    tenantId: params.tenantId,
    initiatingOrigin: params.initiatingOrigin,
    innerState,
    nonce,
    ttlMs: params.ttlMs,
    now: params.now,
  });
  url.searchParams.set("state", wrapped);
  return url.toString();
}
