import type { ChangelogEntry, RoadmapItem } from "@/lib/content/types";

/**
 * PRODUKT-UPDATES (Changelog + Roadmap) — Pflege-Schicht.
 *
 * Bis 2026-08-23 gab es diese Inhalte nur per Seed-Skript; gepflegt werden
 * konnten sie von Kunden gar nicht. Hier liegt die Domänen-Schicht dafür:
 * validieren, schreiben, löschen — genutzt von der Admin-API UND den
 * MCP-Werkzeugen, damit beide Türen dieselben Regeln haben.
 *
 * VERSIONSNUMMER (0030): frei wählbarer Text (kein SemVer-Zwang — Kunden
 * nutzen „2.4.0", „R25-08" oder „Frühjahr 2026"), optionale Stufe für das
 * Badge. Nichts davon ist Pflicht; ein Changelog ohne Versionen bleibt gültig.
 */

export const CHANGELOG_LEVELS = ["major", "minor", "patch"] as const;
export type ChangelogLevel = (typeof CHANGELOG_LEVELS)[number];

export const MAX_CHANGELOG_TITLE = 160;
export const MAX_CHANGELOG_DESCRIPTION = 2_000;
export const MAX_VERSION_CHARS = 32;
export const MAX_ROADMAP_TITLE = 160;

export const ROADMAP_STATUS = ["planned", "in_progress", "shipped"] as const;
export type RoadmapStatus = (typeof ROADMAP_STATUS)[number];

export interface ChangelogInput {
  title: string;
  description: string;
  /** Freie Versionsnummer des KUNDEN-Produkts; null = ohne. */
  version: string | null;
  level: ChangelogLevel | null;
  /** Veröffentlichungszeitpunkt (unixepoch); fehlt = jetzt. */
  publishedAt?: number;
}

export interface RoadmapInput {
  title: string;
  status: RoadmapStatus;
  /** Sortierung (kleiner = weiter oben); fehlt = ans Ende. */
  sort?: number;
}

/** Changelog-Eintrag inklusive Pflegefelder (Admin-Sicht). */
export interface ChangelogAdminEntry extends ChangelogEntry {
  version: string | null;
  level: ChangelogLevel | null;
  publishedAt: number;
}

export interface RoadmapAdminItem extends RoadmapItem {
  sort: number;
}

type Fail = { ok: false; error: string };
type Ok<T> = { ok: true; value: T };

const trimmed = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/**
 * Strenge Validierung für den Schreib-Pfad (API + MCP). Bewusst dieselbe
 * Funktion für beide: eine zweite Tür darf keine zweite Regel haben.
 */
export function validateChangelogInput(raw: unknown): Ok<ChangelogInput> | Fail {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid_body" };
  const o = raw as Record<string, unknown>;

  const title = trimmed(o.title);
  if (title.length === 0 || title.length > MAX_CHANGELOG_TITLE) {
    return { ok: false, error: "invalid_title" };
  }
  const description = trimmed(o.description);
  if (description.length > MAX_CHANGELOG_DESCRIPTION) {
    return { ok: false, error: "invalid_description" };
  }

  // Version: leer/fehlend = bewusst ohne Versionsnummer.
  const rawVersion = trimmed(o.version);
  if (rawVersion.length > MAX_VERSION_CHARS) return { ok: false, error: "invalid_version" };
  const version = rawVersion.length > 0 ? rawVersion : null;

  let level: ChangelogLevel | null = null;
  if (o.level !== undefined && o.level !== null && o.level !== "") {
    if (!(CHANGELOG_LEVELS as readonly unknown[]).includes(o.level)) {
      return { ok: false, error: "invalid_level" };
    }
    level = o.level as ChangelogLevel;
  }

  let publishedAt: number | undefined;
  if (o.publishedAt !== undefined && o.publishedAt !== null) {
    if (typeof o.publishedAt !== "number" || !Number.isFinite(o.publishedAt) || o.publishedAt < 0) {
      return { ok: false, error: "invalid_published_at" };
    }
    publishedAt = Math.floor(o.publishedAt);
  }

  return { ok: true, value: { title, description, version, level, publishedAt } };
}

export function validateRoadmapInput(raw: unknown): Ok<RoadmapInput> | Fail {
  if (typeof raw !== "object" || raw === null) return { ok: false, error: "invalid_body" };
  const o = raw as Record<string, unknown>;

  const title = trimmed(o.title);
  if (title.length === 0 || title.length > MAX_ROADMAP_TITLE) {
    return { ok: false, error: "invalid_title" };
  }
  const status = o.status === undefined || o.status === null ? "planned" : o.status;
  if (!(ROADMAP_STATUS as readonly unknown[]).includes(status)) {
    return { ok: false, error: "invalid_status" };
  }
  let sort: number | undefined;
  if (o.sort !== undefined && o.sort !== null) {
    if (typeof o.sort !== "number" || !Number.isFinite(o.sort)) {
      return { ok: false, error: "invalid_sort" };
    }
    sort = Math.trunc(o.sort);
  }
  return { ok: true, value: { title, status: status as RoadmapStatus, sort } };
}

/** Pflege-Zugriff auf Changelog + Roadmap (D1-Implementierung unten). */
export interface UpdatesStore {
  listChangelog(tenantId: string): Promise<ChangelogAdminEntry[]>;
  createChangelog(tenantId: string, input: ChangelogInput, now: number): Promise<ChangelogAdminEntry>;
  updateChangelog(
    tenantId: string,
    id: string,
    input: ChangelogInput,
  ): Promise<ChangelogAdminEntry | null>;
  deleteChangelog(tenantId: string, id: string): Promise<boolean>;

  listRoadmap(tenantId: string): Promise<RoadmapAdminItem[]>;
  createRoadmap(tenantId: string, input: RoadmapInput): Promise<RoadmapAdminItem>;
  updateRoadmap(tenantId: string, id: string, input: RoadmapInput): Promise<RoadmapAdminItem | null>;
  deleteRoadmap(tenantId: string, id: string): Promise<boolean>;
}

interface ChangelogRow {
  id: string;
  published_at: number;
  title: string;
  description: string;
  version: string | null;
  level: string | null;
}

function rowToChangelog(row: ChangelogRow, locale: string): ChangelogAdminEntry {
  return {
    id: row.id,
    dateLabel: new Intl.DateTimeFormat(locale === "en" ? "en-GB" : "de-DE", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    }).format(new Date(row.published_at * 1000)),
    title: row.title,
    description: row.description,
    version: row.version,
    level: (CHANGELOG_LEVELS as readonly string[]).includes(row.level ?? "")
      ? (row.level as ChangelogLevel)
      : null,
    publishedAt: row.published_at,
  };
}

/** D1-gestützte Pflege. Alle Abfragen sind tenant-gescoped (Isolations-Invariante). */
export class D1UpdatesStore implements UpdatesStore {
  constructor(
    private readonly db: D1Database,
    private readonly locale: string = "de",
  ) {}

  async listChangelog(tenantId: string): Promise<ChangelogAdminEntry[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, published_at, title, description, version, level FROM changelog_entries
          WHERE tenant_id = ? ORDER BY published_at DESC`,
      )
      .bind(tenantId)
      .all<ChangelogRow>();
    return results.map((r) => rowToChangelog(r, this.locale));
  }

  async createChangelog(
    tenantId: string,
    input: ChangelogInput,
    now: number,
  ): Promise<ChangelogAdminEntry> {
    const id = `cl_${crypto.randomUUID()}`;
    const publishedAt = input.publishedAt ?? now;
    await this.db
      .prepare(
        `INSERT INTO changelog_entries (id, tenant_id, published_at, title, description, version, level)
          VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(id, tenantId, publishedAt, input.title, input.description, input.version, input.level)
      .run();
    return {
      id,
      dateLabel: rowToChangelog(
        { id, published_at: publishedAt, title: input.title, description: input.description, version: input.version, level: input.level },
        this.locale,
      ).dateLabel,
      title: input.title,
      description: input.description,
      version: input.version,
      level: input.level,
      publishedAt,
    };
  }

  async updateChangelog(
    tenantId: string,
    id: string,
    input: ChangelogInput,
  ): Promise<ChangelogAdminEntry | null> {
    // publishedAt nur überschreiben, wenn mitgegeben — sonst bleibt das
    // ursprüngliche Datum stehen (ein Tippfehler-Fix soll nicht umdatieren).
    const res = await this.db
      .prepare(
        `UPDATE changelog_entries
            SET title = ?, description = ?, version = ?, level = ?,
                published_at = COALESCE(?, published_at)
          WHERE tenant_id = ? AND id = ?`,
      )
      .bind(
        input.title,
        input.description,
        input.version,
        input.level,
        input.publishedAt ?? null,
        tenantId,
        id,
      )
      .run();
    if ((res.meta.changes ?? 0) === 0) return null;

    const row = await this.db
      .prepare(
        `SELECT id, published_at, title, description, version, level FROM changelog_entries
          WHERE tenant_id = ? AND id = ?`,
      )
      .bind(tenantId, id)
      .first<ChangelogRow>();
    return row ? rowToChangelog(row, this.locale) : null;
  }

  async deleteChangelog(tenantId: string, id: string): Promise<boolean> {
    const res = await this.db
      .prepare(`DELETE FROM changelog_entries WHERE tenant_id = ? AND id = ?`)
      .bind(tenantId, id)
      .run();
    return (res.meta.changes ?? 0) > 0;
  }

  async listRoadmap(tenantId: string): Promise<RoadmapAdminItem[]> {
    const { results } = await this.db
      .prepare(
        `SELECT id, title, status, sort FROM roadmap_items
          WHERE tenant_id = ? ORDER BY sort ASC, created_at ASC`,
      )
      .bind(tenantId)
      .all<{ id: string; title: string; status: RoadmapStatus; sort: number }>();
    return results.map((r) => ({ id: r.id, title: r.title, status: r.status, sort: r.sort }));
  }

  async createRoadmap(tenantId: string, input: RoadmapInput): Promise<RoadmapAdminItem> {
    const id = `rm_${crypto.randomUUID()}`;
    // Ohne `sort` ans Ende: neue Einträge sollen bestehende Reihenfolgen nicht
    // durcheinanderwerfen.
    const sort =
      input.sort ??
      ((
        await this.db
          .prepare(`SELECT COALESCE(MAX(sort), 0) + 10 AS next FROM roadmap_items WHERE tenant_id = ?`)
          .bind(tenantId)
          .first<{ next: number }>()
      )?.next ?? 10);
    await this.db
      .prepare(`INSERT INTO roadmap_items (id, tenant_id, title, status, sort) VALUES (?, ?, ?, ?, ?)`)
      .bind(id, tenantId, input.title, input.status, sort)
      .run();
    return { id, title: input.title, status: input.status, sort };
  }

  async updateRoadmap(
    tenantId: string,
    id: string,
    input: RoadmapInput,
  ): Promise<RoadmapAdminItem | null> {
    const res = await this.db
      .prepare(
        `UPDATE roadmap_items SET title = ?, status = ?, sort = COALESCE(?, sort)
          WHERE tenant_id = ? AND id = ?`,
      )
      .bind(input.title, input.status, input.sort ?? null, tenantId, id)
      .run();
    if ((res.meta.changes ?? 0) === 0) return null;
    const row = await this.db
      .prepare(`SELECT id, title, status, sort FROM roadmap_items WHERE tenant_id = ? AND id = ?`)
      .bind(tenantId, id)
      .first<{ id: string; title: string; status: RoadmapStatus; sort: number }>();
    return row ?? null;
  }

  async deleteRoadmap(tenantId: string, id: string): Promise<boolean> {
    const res = await this.db
      .prepare(`DELETE FROM roadmap_items WHERE tenant_id = ? AND id = ?`)
      .bind(tenantId, id)
      .run();
    return (res.meta.changes ?? 0) > 0;
  }
}
