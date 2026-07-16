import { deriveTenantKey } from "@/server/auth/crypto";

/**
 * SIGNIERTE BESUCHER-IDs (Abuse-Härtung, 2026-07-16).
 *
 * Problem: Die anonyme Besucher-ID (hoh_vid-Cookie) steuert MAU-Zählung und
 * View-Dedup. Ein Angreifer, der beliebige IDs ERFINDEN kann, umgeht das
 * Dedup (Credits-Sabotage) und bläht die MAU des Tenants auf (usage_mau-
 * Zeilen = D1-Storage + verfälschte Abrechnungsgrundlage).
 *
 * Lösung: IDs sind `<random>.<hmac>` — HMAC-SHA256 über den Zufallsteil mit
 * einem PER-TENANT abgeleiteten Schlüssel (HKDF(AUTH_SECRET, tenantId), wie
 * bei Cookies/OAuth-state). Nur vom Server ausgestellte IDs verifizieren;
 * gefälschte/fremde (auch von ANDEREN Tenants kopierte) werden verworfen und
 * wie „neuer Besucher" behandelt — und die NEUVERGABE läuft über die
 * rate-limitierten Event-Endpunkte. Rotation kostet den Angreifer damit
 * echte Requests gegen das IP-Limit statt kostenloser Cookie-Fantasie.
 *
 * Kein Secret verfügbar (dev ohne Bindings) ⇒ Codec entfällt (runtime-deps
 * lässt das Feld weg) und die IDs bleiben unsigniert — dort gibt es kein
 * Billing. Deployed ist AUTH_SECRET immer vorhanden.
 */

export interface VisitorIdCodec {
  issue(tenantId: string): Promise<string>;
  /** Gültige ID zurückgeben (unverändert) oder null (fälschungsverdächtig). */
  verify(tenantId: string, value: string): Promise<string | null>;
}

const RANDOM_BYTES = 16;
const SIG_CHARS = 22; // 128 Bit HMAC-Präfix, base64url (22 Zeichen)

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmacKey(secret: string, tenantId: string): Promise<CryptoKey> {
  // Eigener HKDF-Kontext via Suffix: Visitor-Schlüssel ≠ Cookie-/State-Schlüssel.
  const derived = await deriveTenantKey(secret, `${tenantId}:visitor-id`);
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(derived),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
}

async function signPart(secret: string, tenantId: string, part: string): Promise<string> {
  const key = await hmacKey(secret, tenantId);
  const mac = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(part));
  return base64url(new Uint8Array(mac)).slice(0, SIG_CHARS);
}

/** Konstantzeit-Vergleich (Timing-Seitenkanal auf dem HMAC vermeiden). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function makeVisitorIdCodec(authSecret: string): VisitorIdCodec {
  return {
    async issue(tenantId: string): Promise<string> {
      const random = new Uint8Array(RANDOM_BYTES);
      crypto.getRandomValues(random);
      const part = base64url(random);
      return `${part}.${await signPart(authSecret, tenantId, part)}`;
    },
    async verify(tenantId: string, value: string): Promise<string | null> {
      if (typeof value !== "string" || value.length > 80) return null;
      const dot = value.indexOf(".");
      if (dot <= 0) return null;
      const part = value.slice(0, dot);
      const sig = value.slice(dot + 1);
      const expected = await signPart(authSecret, tenantId, part);
      return timingSafeEqual(sig, expected) ? value : null;
    },
  };
}
