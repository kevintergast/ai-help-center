import type { ArticleStatus } from "@/lib/content/types";
import {
  SAMPLE_ARTICLES,
  SAMPLE_CHANGELOG,
  SAMPLE_ROADMAP,
} from "@/lib/content/fake-repo";

/**
 * DEV-ONLY Content-Seed (analog zur Tenant-Demo-Registry). Schreibt die
 * Beispiel-Artikel/Roadmap/Changelog aus fake-repo.ts für die Demo-Tenants in die
 * LOKALE D1, damit Admin + Hilfezentrum lokal echte Inhalte zeigen.
 *
 * BEWUSST NICHT Teil einer Migration (forward-only-Migrationen enthalten kein
 * Demo-Content) und NICHT in Prod: `seedDemoContent` wirft, wenn
 * `NODE_ENV === 'production'`. Idempotent: Tenants mit vorhandenen Artikeln werden
 * übersprungen, INSERTs sind `OR IGNORE`.
 *
 * IDs bleiben die fachlichen Sample-IDs (z. B. "start-account") — der COMPOSITE
 * PRIMARY KEY (tenant_id, id) erlaubt dieselbe ID pro Tenant, und die `relatedIds`
 * der Beispiele referenzieren genau diese IDs (bleiben also konsistent).
 */

export const DEMO_TENANT_IDS = ["t_demo", "t_acme"] as const;

/** Anzeige-Status → Storage (status, is_ai_generated, published?). */
function toStorage(status: ArticleStatus): {
  storage: "draft" | "published" | "archived";
  isAi: 0 | 1;
  published: boolean;
} {
  switch (status) {
    case "draft":
      return { storage: "draft", isAi: 0, published: false };
    case "ai":
      return { storage: "published", isAi: 1, published: true };
    // "current" und "stale" sind veröffentlichte Zustände (stale = zeitbasiert, P5).
    default:
      return { storage: "published", isAi: 0, published: true };
  }
}

// Feste Unix-Zeitstempel für die Changelog-Demo (statt der DE-Label-Strings).
const CHANGELOG_DATES = [
  Math.floor(Date.UTC(2026, 6, 8) / 1000),
  Math.floor(Date.UTC(2026, 6, 1) / 1000),
  Math.floor(Date.UTC(2026, 5, 24) / 1000),
];

/**
 * Seedet den Demo-Content für die angegebenen Tenants in die (lokale) D1.
 * Aufruf lokal, z. B. aus einem Dev-Skript/Dev-Route mit der D1-Bindung.
 */
export async function seedDemoContent(
  db: D1Database,
  tenantIds: readonly string[] = DEMO_TENANT_IDS,
  nowSec = Math.floor(Date.now() / 1000),
): Promise<{ seeded: string[]; skipped: string[] }> {
  if (process.env.NODE_ENV === "production") {
    throw new Error("seedDemoContent: refusing to run in production (dev-only demo content).");
  }

  const seeded: string[] = [];
  const skipped: string[] = [];

  for (const tenantId of tenantIds) {
    const existing = await db
      .prepare(`SELECT COUNT(*) AS n FROM articles WHERE tenant_id = ?`)
      .bind(tenantId)
      .first<{ n: number }>();
    if ((existing?.n ?? 0) > 0) {
      skipped.push(tenantId);
      continue;
    }

    for (const a of SAMPLE_ARTICLES) {
      const { storage, isAi, published } = toStorage(a.status);
      await db
        .prepare(
          `INSERT OR IGNORE INTO articles
             (id, tenant_id, locale, slug, title, category, status,
              body_json, videos_json, related_ids_json, reading_minutes,
              is_ai_generated, published_at)
           VALUES (?, ?, 'de', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          a.id,
          tenantId,
          a.slug,
          a.title,
          a.category,
          storage,
          JSON.stringify(a.body),
          JSON.stringify(a.videos),
          JSON.stringify(a.relatedIds),
          a.readingMinutes,
          isAi,
          published ? nowSec : null,
        )
        .run();
    }

    for (let i = 0; i < SAMPLE_ROADMAP.length; i++) {
      const item = SAMPLE_ROADMAP[i];
      await db
        .prepare(
          `INSERT OR IGNORE INTO roadmap_items (id, tenant_id, title, status, sort)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(item.id, tenantId, item.title, item.status, i)
        .run();
    }

    for (let i = 0; i < SAMPLE_CHANGELOG.length; i++) {
      const entry = SAMPLE_CHANGELOG[i];
      await db
        .prepare(
          `INSERT OR IGNORE INTO changelog_entries
             (id, tenant_id, published_at, title, description)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .bind(entry.id, tenantId, CHANGELOG_DATES[i] ?? nowSec, entry.title, entry.description)
        .run();
    }

    seeded.push(tenantId);
  }

  return { seeded, skipped };
}
