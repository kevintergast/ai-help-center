import { readStoredScopes, type ApiScope } from "./scopes";

/**
 * Persistenz der API-Keys (`api_key`, migrations/0027_api_keys.sql).
 *
 * Muster wie branding/store.ts: strukturelles Interface + D1-Implementierung;
 * Tests fahren dieselbe Klasse über den sqlite-Shim gegen die ECHTE
 * Migrations-DDL (kein Fake-SQL, damit CHECK/PK/Index mitgetestet sind).
 *
 * ISOLATIONS-REGEL: `tenant_id` steht in JEDER WHERE-Klausel — auch dort, wo
 * die `id` allein schon eindeutig wäre. Ein Schlüssel/eine Id aus einem fremden
 * Mandanten trifft damit strukturell ins Leere, nicht erst dank Anwendungslogik.
 */

/** Ein Schlüssel, wie ihn Admin-Liste und Auth-Pfad sehen — NIE der Klartext. */
export interface ApiKeyRecord {
  id: string;
  tenantId: string;
  name: string;
  keyPrefix: string;
  scopes: ApiScope[];
  createdBy: string | null;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
}

export interface CreateApiKeyInput {
  id: string;
  tenantId: string;
  name: string;
  /** SHA-256(Klartext) — der Klartext selbst wird nirgends gespeichert. */
  keyHash: string;
  keyPrefix: string;
  scopes: readonly ApiScope[];
  createdBy: string | null;
  createdAt: number;
  expiresAt: number;
}

export interface ApiKeyRepository {
  create(input: CreateApiKeyInput): Promise<void>;
  /** Admin-Liste (neueste zuerst), inklusive widerrufener/abgelaufener. */
  listByTenant(tenantId: string): Promise<ApiKeyRecord[]>;
  /**
   * DER Auth-Pfad. Liefert nur einen Schlüssel, der JETZT benutzbar ist:
   * richtiger Mandant, nicht widerrufen, nicht abgelaufen. Die Prüfung steckt
   * bewusst im SQL — so kann kein Aufrufer sie vergessen.
   */
  findUsableByHash(tenantId: string, keyHash: string, nowSec: number): Promise<ApiKeyRecord | null>;
  /** „zuletzt benutzt" (gedrosselt, s. TOUCH_INTERVAL_SEC). */
  touch(tenantId: string, id: string, nowSec: number): Promise<void>;
  /** true = wurde jetzt widerrufen; false = unbekannt oder schon widerrufen. */
  revoke(tenantId: string, id: string, nowSec: number): Promise<boolean>;
}

/** Häufiger als einmal pro Minute ist „zuletzt benutzt" keinen D1-Write wert. */
export const TOUCH_INTERVAL_SEC = 60;

/** Pro Request aufgelöste Key-Infrastruktur (null = kein D1 → 503 fail-closed). */
export interface ApiKeyDeps {
  repo: ApiKeyRepository;
}

interface Row {
  id: string;
  tenant_id: string;
  name: string;
  key_prefix: string;
  scopes: string;
  created_by: string | null;
  created_at: number;
  expires_at: number;
  last_used_at: number | null;
  revoked_at: number | null;
}

function toRecord(row: Row): ApiKeyRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    name: row.name,
    keyPrefix: row.key_prefix,
    scopes: readStoredScopes(row.scopes),
    createdBy: row.created_by,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    lastUsedAt: row.last_used_at,
    revokedAt: row.revoked_at,
  };
}

const SELECT_COLUMNS =
  "id, tenant_id, name, key_prefix, scopes, created_by, created_at, expires_at, last_used_at, revoked_at";

export class D1ApiKeyRepository implements ApiKeyRepository {
  constructor(private readonly db: D1Database) {}

  async create(input: CreateApiKeyInput): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO api_key
           (tenant_id, id, name, key_hash, key_prefix, scopes, created_by, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        input.tenantId,
        input.id,
        input.name,
        input.keyHash,
        input.keyPrefix,
        JSON.stringify([...input.scopes]),
        input.createdBy,
        input.createdAt,
        input.expiresAt,
      )
      .run();
  }

  async listByTenant(tenantId: string): Promise<ApiKeyRecord[]> {
    const { results } = await this.db
      .prepare(`SELECT ${SELECT_COLUMNS} FROM api_key WHERE tenant_id = ? ORDER BY created_at DESC`)
      .bind(tenantId)
      .all<Row>();
    return (results ?? []).map(toRecord);
  }

  async findUsableByHash(
    tenantId: string,
    keyHash: string,
    nowSec: number,
  ): Promise<ApiKeyRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ${SELECT_COLUMNS} FROM api_key
          WHERE tenant_id = ? AND key_hash = ? AND revoked_at IS NULL AND expires_at > ?`,
      )
      .bind(tenantId, keyHash, nowSec)
      .first<Row>();
    return row ? toRecord(row) : null;
  }

  async touch(tenantId: string, id: string, nowSec: number): Promise<void> {
    await this.db
      .prepare(
        `UPDATE api_key SET last_used_at = ?
          WHERE tenant_id = ? AND id = ?
            AND (last_used_at IS NULL OR last_used_at < ?)`,
      )
      .bind(nowSec, tenantId, id, nowSec - TOUCH_INTERVAL_SEC)
      .run();
  }

  async revoke(tenantId: string, id: string, nowSec: number): Promise<boolean> {
    const result = await this.db
      .prepare(`UPDATE api_key SET revoked_at = ? WHERE tenant_id = ? AND id = ? AND revoked_at IS NULL`)
      .bind(nowSec, tenantId, id)
      .run();
    return (result.meta?.changes ?? 0) > 0;
  }
}
