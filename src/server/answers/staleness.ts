import type { SourceRef } from "@/lib/content/types";
import { changelogDoc, parseDocId, roadmapDoc, type AuxDoc } from "@/server/search/aux-docs";
import { buildChunks } from "@/server/search/chunking";
import { toIndexable } from "@/server/search/sync";

/**
 * STALENESS-ERKENNUNG gespeicherter KI-Antworten (Architektur-Kernstück:
 * „Jeder generierte Artikel merkt sich Quell-Chunks + content_hash; ändern
 * sich die Quellen, wird er als veraltet markiert").
 *
 * Prüfprinzip: für die sourceRefs einer Antwort werden die HEUTIGEN Hashes
 * der Quellen rekonstruiert — mit exakt denselben Buildern wie Indexierung
 * und Antwort-Kontext (buildChunks/aux-docs) — und gegen die beim Generieren
 * gespeicherten Hashes verglichen. VERALTET, wenn irgendeine Quelle:
 *  - nicht mehr existiert oder nicht mehr veröffentlicht ist,
 *  - den referenzierten Chunk nicht mehr hat (Artikel wurde kürzer),
 *  - am Chunk-Index einen ANDEREN Hash trägt (Inhalt geändert).
 *
 * Antworten OHNE Refs (grounded:false oder Altbestand) sind nie „veraltet"
 * — es gibt nichts, wogegen man vergleichen könnte (ehrlich bleiben, nicht
 * raten). Nur DB nötig (kein Embedding, keine KI) → billig und sqlite-testbar.
 */

export type AnswerRefs = { id: string; refs: SourceRef[] };

export async function findStaleAnswers(
  env: { DB: D1Database },
  tenantId: string,
  answers: AnswerRefs[],
): Promise<string[]> {
  // 1) Benötigte Quell-Dokumente einsammeln (dedupliziert über alle Antworten).
  const articleIds = new Set<string>();
  const roadmapIds = new Set<string>();
  const changelogIds = new Set<string>();
  for (const a of answers) {
    for (const ref of a.refs) {
      const parsed = parseDocId(ref.articleId);
      if (parsed.kind === "article") articleIds.add(ref.articleId);
      else if (parsed.kind === "roadmap") roadmapIds.add(parsed.rawId);
      else changelogIds.add(parsed.rawId);
    }
  }

  // 2) Aktuelle Chunk-Hashes je Dokument-Id aufbauen (fehlend ⇒ kein Eintrag).
  const hashesByDoc = new Map<string, string[]>();

  if (articleIds.size > 0) {
    const placeholders = [...articleIds].map(() => "?").join(",");
    const rows = await env.DB.prepare(
      `SELECT id, slug, title, body_json, images_json, videos_json FROM articles
        WHERE tenant_id = ? AND status = 'published' AND id IN (${placeholders})`,
    )
      .bind(tenantId, ...articleIds)
      .all<{ id: string; slug: string; title: string; body_json: string }>();
    for (const row of rows.results) {
      const chunks = await buildChunks(toIndexable(row));
      hashesByDoc.set(
        row.id,
        chunks.map((c) => c.hash),
      );
    }
  }

  const addAuxHashes = async (doc: AuxDoc) => {
    const chunks = await buildChunks(doc);
    hashesByDoc.set(
      doc.id,
      chunks.map((c) => c.hash),
    );
  };
  if (roadmapIds.size > 0) {
    const placeholders = [...roadmapIds].map(() => "?").join(",");
    const rows = await env.DB.prepare(
      `SELECT id, title, status FROM roadmap_items WHERE tenant_id = ? AND id IN (${placeholders})`,
    )
      .bind(tenantId, ...roadmapIds)
      .all<{ id: string; title: string; status: string }>();
    for (const row of rows.results) await addAuxHashes(roadmapDoc(row));
  }
  if (changelogIds.size > 0) {
    const placeholders = [...changelogIds].map(() => "?").join(",");
    const rows = await env.DB.prepare(
      `SELECT id, title, description FROM changelog_entries
        WHERE tenant_id = ? AND id IN (${placeholders})`,
    )
      .bind(tenantId, ...changelogIds)
      .all<{ id: string; title: string; description: string }>();
    for (const row of rows.results) await addAuxHashes(changelogDoc(row));
  }

  // 3) Vergleich pro Antwort.
  const stale: string[] = [];
  for (const a of answers) {
    if (a.refs.length === 0) continue; // nichts zu vergleichen → nie „veraltet"
    const isStale = a.refs.some((ref) => {
      const hashes = hashesByDoc.get(ref.articleId);
      if (!hashes) return true; // Quelle weg/unveröffentlicht
      const current = hashes[ref.chunkIndex];
      return current === undefined || current !== ref.contentHash;
    });
    if (isStale) stale.push(a.id);
  }
  return stale;
}
