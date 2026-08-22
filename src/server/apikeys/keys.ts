/**
 * SCHLÜSSEL-PRIMITIVE: erzeugen, hashen, aus dem Header lesen.
 *
 * Transport- und speicherfrei (Web Crypto, läuft in Workers UND Node/Tests) —
 * die Persistenz liegt in `store.ts`, die Auth-Entscheidung in `authenticate.ts`.
 *
 * FORMAT: `hoh_<43 Zeichen base64url>` aus 32 Zufalls-Bytes (256 Bit).
 * Das feste Präfix macht den Schlüssel in Logs/Repos für Secret-Scanner
 * erkennbar (GitHub Push Protection & Co. suchen genau solche Muster) und
 * erlaubt uns, offensichtlich falsche Bearer-Werte ohne DB-Zugriff abzulehnen.
 */

import type { ApiScope } from "./scopes";

export const KEY_TOKEN_PREFIX = "hoh_";
/** Zeichen, die wir zur Wiedererkennung speichern/anzeigen (inkl. Präfix). */
export const KEY_PREFIX_LENGTH = 12;
const RANDOM_BYTES = 32;

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export interface GeneratedKey {
  /** Klartext — existiert genau einmal und wird NIE gespeichert. */
  token: string;
  /** Erste Zeichen, gespeichert zur Wiedererkennung in der Liste. */
  prefix: string;
}

export function generateApiKey(): GeneratedKey {
  const bytes = new Uint8Array(RANDOM_BYTES);
  crypto.getRandomValues(bytes);
  const token = KEY_TOKEN_PREFIX + base64url(bytes);
  return { token, prefix: token.slice(0, KEY_PREFIX_LENGTH) };
}

/**
 * SHA-256(hex) des Klartext-Schlüssels — das ist, was in D1 liegt.
 * Bewusst kein Passwort-KDF: der Schlüssel ist ein 256-Bit-Zufallswert, es gibt
 * dort nichts zu raten (anders als bei einem menschlichen Passwort).
 */
export async function hashApiKey(token: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Bearer-Token aus dem Authorization-Header. Gibt `null` zurück, wenn kein
 * Bearer-Schema vorliegt oder der Wert offensichtlich keiner unserer Schlüssel
 * ist (falsches Präfix) — spart den DB-Roundtrip und trennt sauber von
 * OAuth-Access-Tokens, die später (Schritt 8) dasselbe Header-Feld nutzen.
 */
export function readBearerKey(header: string | null | undefined): string | null {
  if (!header) return null;
  const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
  if (!match) return null;
  const token = match[1];
  return token.startsWith(KEY_TOKEN_PREFIX) ? token : null;
}

/**
 * Der authentifizierte Maschinen-Prinzipal eines Requests. Bewusst KEIN
 * `userId`: der Schlüssel handelt für die Instanz, nicht als Person — wer ihn
 * erstellt hat, steht im Audit-Log und in der Key-Liste.
 */
export interface ApiKeyPrincipal {
  type: "api_key";
  keyId: string;
  tenantId: string;
  name: string;
  scopes: ApiScope[];
}
