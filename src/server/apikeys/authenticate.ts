import { hashApiKey, readBearerKey, type ApiKeyPrincipal } from "./keys";
import { TOUCH_INTERVAL_SEC, type ApiKeyRepository } from "./store";

/**
 * AUTHENTIFIZIERUNG eines Bearer-API-Keys — die einzige Stelle, an der aus
 * einem Header ein Prinzipal wird.
 *
 * FAIL-CLOSED an jeder Abzweigung: kein Bearer, falsches Präfix, unbekannter
 * Hash, widerrufen oder abgelaufen ⇒ `null`. Es gibt keinen Zweig, der bei
 * einem Infrastrukturfehler durchlässt (der Aufrufer antwortet dann 401).
 *
 * TENANT: kommt als Argument aus der Host-Auflösung — NIE aus dem Token. Ein
 * gültiger Schlüssel von Tenant A ist auf dem Host von Tenant B damit
 * unbekannt (die WHERE-Klausel trifft ins Leere), ohne dass hier eine
 * Vergleichslogik nötig wäre, die man vergessen könnte.
 */
export async function authenticateApiKey(
  repo: ApiKeyRepository,
  tenantId: string,
  authorizationHeader: string | null | undefined,
  nowSec: number,
): Promise<ApiKeyPrincipal | null> {
  const token = readBearerKey(authorizationHeader);
  if (!token) return null;

  const record = await repo.findUsableByHash(tenantId, await hashApiKey(token), nowSec);
  if (!record) return null;

  // „zuletzt benutzt" ist Komfort, kein Sicherheitsmerkmal: ein Fehler hier
  // darf den Request nicht kippen (und wir schreiben höchstens 1x/Minute).
  if (record.lastUsedAt === null || record.lastUsedAt < nowSec - TOUCH_INTERVAL_SEC) {
    try {
      await repo.touch(tenantId, record.id, nowSec);
    } catch (err) {
      console.error("[api-key] touch fehlgeschlagen (ignoriert):", err);
    }
  }

  return {
    type: "api_key",
    keyId: record.id,
    tenantId,
    name: record.name,
    scopes: record.scopes,
  };
}
