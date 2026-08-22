import type { ConfirmationCodec, ConfirmationSubject } from "./tools/types";

/**
 * BESTÄTIGUNGS-TOKEN für zerstörende Aktionen (docs/mcp-plan.md §7).
 *
 * Regel: Ein Löschbefehl aus einer KI-Sitzung löscht NIE im ersten Anlauf. Der
 * erste Aufruf beschreibt, was verschwinden würde, und gibt ein Token aus; erst
 * der zweite Aufruf mit diesem Token führt aus. Der Mensch dazwischen ist der
 * Punkt der Übung.
 *
 * Das Token ist ein HMAC-SHA256 über (Tenant | Schlüssel | Aktion | Ziel |
 * Fingerabdruck des Ziels | Ablauf), signiert mit dem tenant-abgeleiteten
 * Secret. Daraus folgt alles Wichtige:
 *  - nicht erfindbar (das Modell kann kein Token halluzinieren),
 *  - nicht übertragbar (anderer Artikel, anderer Schlüssel, anderer Mandant =
 *    andere Signatur),
 *  - nicht „vorrätig" (5 Minuten),
 *  - wertlos, wenn sich das Ziel zwischenzeitlich geändert hat (Fingerabdruck).
 *
 * EINMALVERBRAUCH über KV (`CACHE`): ein verbrauchtes Token ist sofort tot,
 * ein Retry löscht also nichts ein zweites Mal. Ohne KV-Binding bleibt die
 * Signatur+TTL wirksam, der Einmalverbrauch nicht — das ist der einzige
 * bewusste Abstrich für lokale Entwicklung (deployed ist KV immer da).
 */

const TTL_SEC = 300;
const KV_PREFIX = "mcp:confirm:";

/** Minimaler KV-Ausschnitt (strukturkompatibel zu KVNamespace). */
export interface ConfirmationStore {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, options?: { expirationTtl?: number }): Promise<void>;
}

function base64url(bytes: Uint8Array): string {
  let bin = "";
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function subjectString(s: ConfirmationSubject, expiresAt: number): string {
  return [s.tenantId, s.keyId, s.action, s.targetId, s.fingerprint, String(expiresAt)].join("|");
}

async function sign(secret: string, payload: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(payload));
  return base64url(new Uint8Array(sig));
}

/** Konstantzeit-Vergleich (kein früher Ausstieg beim ersten Unterschied). */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

export function makeConfirmationCodec(opts: {
  secret: string;
  now(): number;
  store?: ConfirmationStore | null;
}): ConfirmationCodec {
  return {
    async issue(subject) {
      const expiresAt = opts.now() + TTL_SEC;
      const signature = await sign(opts.secret, subjectString(subject, expiresAt));
      return `${expiresAt}.${signature}`;
    },

    async consume(token, subject) {
      const [rawExpiry, signature] = token.split(".");
      const expiresAt = Number(rawExpiry);
      if (!signature || !Number.isInteger(expiresAt)) return false;
      if (expiresAt <= opts.now()) return false;

      const expected = await sign(opts.secret, subjectString(subject, expiresAt));
      if (!timingSafeEqual(signature, expected)) return false;

      // Einmalverbrauch: der erste Aufruf gewinnt, jeder weitere sieht die
      // Markierung. (KV ist eventual consistent — für „zweimal löschen" reicht
      // das: die zweite Löschung fände ohnehin nichts mehr vor.)
      if (opts.store) {
        const kvKey = KV_PREFIX + signature;
        if (await opts.store.get(kvKey)) return false;
        await opts.store.put(kvKey, "1", { expirationTtl: TTL_SEC });
      }
      return true;
    },
  };
}
