import type { LegalDocData, LegalDocType, LegalMode } from "./validate";
import { LEGAL_DOC_TYPES } from "./validate";

/**
 * Persistenz für Legal-Docs pro Instanz (`tenant_legal_docs`).
 *
 * Wie bei branding/store.ts sind die Interfaces bewusst minimal/strukturell:
 * die echte D1Database erfüllt sie direkt, Tests speisen einen Map-basierten
 * Fake ein (Repository-Pattern, keine echten Bindings in Tests).
 *
 * ISOLATIONS-INVARIANTE: JEDE Query ist über `WHERE tenant_id = ?` gebunden;
 * die Tenant-ID kommt IMMER aus der Host-Auflösung (`c.get("tenant").id`),
 * niemals aus Param/Body/Query. Kein Cross-Tenant-Zugriff möglich.
 */

/** Ein gespeichertes Dokument samt Zeitstempel (Unix-Epoche, Sekunden). */
export interface LegalDocRecord extends LegalDocData {
  updatedAt: number;
}

/** Vorhandenseins-/Modus-Übersicht eines Dokumenttyps (Admin-Übersicht). */
export interface LegalDocStatus {
  docType: LegalDocType;
  present: boolean;
  mode: LegalMode | null;
  updatedAt: number | null;
}

export interface LegalRepository {
  /** Dokument setzen/ersetzen (upsert), `updated_at = unixepoch()`. NUR für diese Tenant-ID. */
  upsert(tenantId: string, docType: LegalDocType, data: LegalDocData): Promise<void>;
  /** Dokument entfernen (idempotent). NUR für diese Tenant-ID. */
  remove(tenantId: string, docType: LegalDocType): Promise<void>;
  /** Ein Dokument lesen (`null` = nicht gesetzt). NUR für diese Tenant-ID. */
  get(tenantId: string, docType: LegalDocType): Promise<LegalDocRecord | null>;
  /** Status ALLER drei Dokumenttypen — fehlende erscheinen als `present:false`. */
  listStatus(tenantId: string): Promise<LegalDocStatus[]>;
}

/** Pro Request aufgelöste Legal-Infrastruktur (`null` = Bindings fehlen → 503). */
export interface LegalDeps {
  repo: LegalRepository;
}

interface LegalRow {
  mode: LegalMode;
  url: string | null;
  markdown: string | null;
  updated_at: number;
}

/** D1-Implementierung — jede Query ist über `WHERE tenant_id = ?` tenant-gebunden. */
export class D1LegalRepository implements LegalRepository {
  constructor(private readonly db: D1Database) {}

  async upsert(tenantId: string, docType: LegalDocType, data: LegalDocData): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO tenant_legal_docs (tenant_id, doc_type, mode, url, markdown, updated_at)
         VALUES (?, ?, ?, ?, ?, unixepoch())
         ON CONFLICT(tenant_id, doc_type) DO UPDATE SET
           mode = excluded.mode,
           url = excluded.url,
           markdown = excluded.markdown,
           updated_at = unixepoch()`,
      )
      .bind(tenantId, docType, data.mode, data.url, data.markdown)
      .run();
  }

  async remove(tenantId: string, docType: LegalDocType): Promise<void> {
    await this.db
      .prepare(`DELETE FROM tenant_legal_docs WHERE tenant_id = ? AND doc_type = ?`)
      .bind(tenantId, docType)
      .run();
  }

  async get(tenantId: string, docType: LegalDocType): Promise<LegalDocRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT mode, url, markdown, updated_at
           FROM tenant_legal_docs
          WHERE tenant_id = ? AND doc_type = ?`,
      )
      .bind(tenantId, docType)
      .first<LegalRow>();
    if (!row) return null;
    return {
      mode: row.mode,
      url: row.url,
      markdown: row.markdown,
      updatedAt: row.updated_at,
    };
  }

  async listStatus(tenantId: string): Promise<LegalDocStatus[]> {
    const { results } = await this.db
      .prepare(
        `SELECT doc_type, mode, updated_at FROM tenant_legal_docs WHERE tenant_id = ?`,
      )
      .bind(tenantId)
      .all<{ doc_type: LegalDocType; mode: LegalMode; updated_at: number }>();

    const byType = new Map(results.map((r) => [r.doc_type, r]));
    return LEGAL_DOC_TYPES.map((docType) => {
      const row = byType.get(docType);
      return {
        docType,
        present: !!row,
        mode: row?.mode ?? null,
        updatedAt: row?.updated_at ?? null,
      };
    });
  }
}
