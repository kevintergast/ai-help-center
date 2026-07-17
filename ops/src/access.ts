/**
 * CLOUDFLARE-ACCESS-GUARD (Defense-in-Depth): Der Zugriff aufs Ops-Dashboard
 * wird primär von Cloudflare Access (Zero Trust) erzwungen — Policy „nur
 * Kevin + hinterlegte E-Mails". Dieser Guard validiert ZUSÄTZLICH im Worker
 * das von Access injizierte JWT (`Cf-Access-Jwt-Assertion`): Signatur gegen
 * die Team-JWKS, Audience (Application-AUD), Issuer, Ablauf. Damit ist das
 * Dashboard selbst dann zu, wenn die Access-Policy versehentlich gelöscht
 * oder die Route umkonfiguriert würde.
 *
 * FAIL-CLOSED: Ohne konfigurierte ACCESS_*-Werte → "unconfigured" (503).
 * EINZIGE Ausnahme: der explizite Dev-Bypass (OPS_DEV_BYPASS via
 * `wrangler dev --var`, s. checkAccess) — deployte Umgebungen können ihn
 * nicht tragen.
 */

export interface OpsEnv {
  DB: D1Database;
  /** Nur für den Lösch-Cleanup (Best-Effort; D1 ist die Wahrheit). */
  MEDIA?: R2Bucket;
  VECTORIZE?: VectorizeIndex;
  APP_ENV?: string;
  ACCESS_TEAM_DOMAIN?: string;
  ACCESS_AUD?: string;
  RESEND_API_KEY?: string;
  /** NUR lokale Entwicklung: wird ausschließlich vom dev-Script per
   *  `wrangler dev --var` gesetzt (steht in KEINER wrangler.toml). */
  OPS_DEV_BYPASS?: string;
}

export type AccessResult =
  | { ok: true; email: string }
  | { ok: false; reason: "unconfigured" | "denied" };

interface Jwk {
  kid: string;
  kty: string;
  n: string;
  e: string;
  alg?: string;
}

/** JWKS-Cache pro Isolate (Access rotiert selten; 1h TTL reicht). */
let jwksCache: { teamDomain: string; keys: Jwk[]; fetchedAt: number } | null = null;
const JWKS_TTL_MS = 60 * 60 * 1000;

async function getJwks(teamDomain: string): Promise<Jwk[]> {
  const now = Date.now();
  if (
    jwksCache &&
    jwksCache.teamDomain === teamDomain &&
    now - jwksCache.fetchedAt < JWKS_TTL_MS
  ) {
    return jwksCache.keys;
  }
  const res = await fetch(`https://${teamDomain}/cdn-cgi/access/certs`);
  if (!res.ok) throw new Error(`JWKS-Abruf fehlgeschlagen (${res.status})`);
  const body = (await res.json()) as { keys?: Jwk[] };
  const keys = (body.keys ?? []).filter((k) => k.kty === "RSA");
  jwksCache = { teamDomain, keys, fetchedAt: now };
  return keys;
}

function b64urlToBytes(s: string): Uint8Array {
  const pad = "=".repeat((4 - (s.length % 4)) % 4);
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/") + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function decodeJson<T>(b64url: string): T | null {
  try {
    return JSON.parse(new TextDecoder().decode(b64urlToBytes(b64url))) as T;
  } catch {
    return null;
  }
}

interface AccessPayload {
  aud?: string | string[];
  iss?: string;
  exp?: number;
  nbf?: number;
  email?: string;
}

/**
 * Validiert ein Access-JWT (RS256). Exportiert für Tests — `jwksOverride`
 * ersetzt den Netz-Abruf durch Test-Schlüssel.
 */
export async function verifyAccessJwt(
  token: string,
  opts: { teamDomain: string; aud: string; nowSec?: number; jwksOverride?: Jwk[] },
): Promise<{ email: string } | null> {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const header = decodeJson<{ alg?: string; kid?: string }>(parts[0]);
  const payload = decodeJson<AccessPayload>(parts[1]);
  if (!header || !payload) return null;
  if (header.alg !== "RS256" || !header.kid) return null;

  // Claims ZUERST (billig) — Signatur zuletzt (teuer).
  const nowSec = opts.nowSec ?? Math.floor(Date.now() / 1000);
  const audiences = Array.isArray(payload.aud) ? payload.aud : [payload.aud];
  if (!audiences.includes(opts.aud)) return null;
  if (payload.iss !== `https://${opts.teamDomain}`) return null;
  if (typeof payload.exp !== "number" || payload.exp < nowSec - 60) return null;
  if (typeof payload.nbf === "number" && payload.nbf > nowSec + 60) return null;
  if (typeof payload.email !== "string" || payload.email.length === 0) return null;

  const keys = opts.jwksOverride ?? (await getJwks(opts.teamDomain));
  const jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) return null;

  const key = await crypto.subtle.importKey(
    "jwk",
    { kty: jwk.kty, n: jwk.n, e: jwk.e },
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false,
    ["verify"],
  );
  const data = new TextEncoder().encode(`${parts[0]}.${parts[1]}`);
  const valid = await crypto.subtle.verify(
    "RSASSA-PKCS1-v1_5",
    key,
    b64urlToBytes(parts[2]) as unknown as ArrayBuffer,
    data,
  );
  return valid ? { email: payload.email } : null;
}

function isConfigured(value: string | undefined): value is string {
  return typeof value === "string" && value.length > 0 && value !== "<FILL>";
}

/** Request-Guard: liefert die Access-Identität oder den Ablehnungsgrund. */
export async function checkAccess(env: OpsEnv, req: Request): Promise<AccessResult> {
  // Dev-Bypass: NUR wenn die Variable explizit per `wrangler dev --var`
  // gesetzt wurde (ops/package.json dev-Script) — sie existiert in keiner
  // wrangler.toml, deployte Umgebungen können sie also nie tragen.
  // (Eine localhost-Heuristik wäre wirkungslos: wrangler dev simuliert die
  // konfigurierte Route-Domain, nie localhost.)
  if (env.OPS_DEV_BYPASS === "1") return { ok: true, email: "dev@localhost" };

  if (!isConfigured(env.ACCESS_AUD) || !isConfigured(env.ACCESS_TEAM_DOMAIN)) {
    return { ok: false, reason: "unconfigured" };
  }

  const token = req.headers.get("cf-access-jwt-assertion");
  if (!token) return { ok: false, reason: "denied" };

  try {
    const verified = await verifyAccessJwt(token, {
      teamDomain: env.ACCESS_TEAM_DOMAIN,
      aud: env.ACCESS_AUD,
    });
    return verified ? { ok: true, email: verified.email } : { ok: false, reason: "denied" };
  } catch {
    // JWKS nicht erreichbar o. Ä. → lieber aussperren als offen lassen.
    return { ok: false, reason: "denied" };
  }
}
