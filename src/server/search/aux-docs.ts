import type { IndexableArticle } from "./indexer";

/** Pseudo-Dokument mit GARANTIERTEM kind (SourceDoc-kompatibel). */
export type AuxDoc = IndexableArticle & { kind: "roadmap" | "changelog" };

/**
 * ROADMAP/CHANGELOG ALS RAG-QUELLEN (Entscheidung 2026-07-16): beide werden
 * als Pseudo-Dokumente indexiert und von der KI mit durchsucht („Kommt
 * Feature X?", „Was ist neu?").
 *
 * DIESE Builder sind die EINZIGE Stelle, die Roadmap-/Changelog-Zeilen in
 * Dokumentform bringt — Indexierung (sync.ts) UND Antwort-Kontext
 * (runtime-deps) nutzen sie gemeinsam, damit die content_hashes beider Seiten
 * exakt übereinstimmen (Grounding lädt Kontext hash-konsistent nach).
 *
 * Pseudo-Ids sind präfixiert (`rm:`/`cl:`) — kollisionsfrei zu Artikel-Ids in
 * search_chunks/Vectorize (article_id hat bewusst keinen FK). Datums-Label
 * bleiben DRAUSSEN (locale-abhängig → Hash-Instabilität).
 */

export interface RoadmapRow {
  id: string;
  title: string;
  status: string;
}

export interface ChangelogRow {
  id: string;
  title: string;
  description: string;
}

/** Menschlich lesbare Status-Wörter (DE+EN — hilft Embedding UND Generierung). */
const ROADMAP_STATUS_TEXT: Record<string, string> = {
  planned: "geplant / planned",
  in_progress: "in Arbeit / in progress",
  shipped: "veröffentlicht / shipped",
};

export function roadmapDoc(row: RoadmapRow): AuxDoc {
  return {
    id: `rm:${row.id}`,
    slug: `roadmap/${row.id}`,
    title: `Roadmap: ${row.title}`,
    // Titel-Terme im Body WIEDERHOLEN: Roadmap-Einträge sind extrem kurz —
    // ohne Verstärkung landen ihre Embedding-Scores systematisch unter der
    // Grounding-Schwelle (real gemessen: 0.542 bei direkt passender Frage).
    body: [
      `Das Feature „${row.title}“ steht auf der Roadmap. Status: ${
        ROADMAP_STATUS_TEXT[row.status] ?? row.status
      }.`,
    ],
    kind: "roadmap",
  };
}

export function changelogDoc(row: ChangelogRow): AuxDoc {
  return {
    id: `cl:${row.id}`,
    slug: `changelog/${row.id}`,
    title: `Changelog: ${row.title}`,
    // Gleiches Muster wie roadmapDoc: Titel-Terme verstärken das Embedding.
    body: [
      `Neu veröffentlicht: ${row.title}.${row.description.length > 0 ? ` ${row.description}` : ""}`,
    ],
    kind: "changelog",
  };
}

/** Pseudo-Id → (kind, Roh-Id); Artikel-Ids laufen unverändert durch. */
export function parseDocId(docId: string): { kind: "article" | "roadmap" | "changelog"; rawId: string } {
  if (docId.startsWith("rm:")) return { kind: "roadmap", rawId: docId.slice(3) };
  if (docId.startsWith("cl:")) return { kind: "changelog", rawId: docId.slice(3) };
  return { kind: "article", rawId: docId };
}
