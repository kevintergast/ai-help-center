-- 0010 — Such-/RAG-Index-Buchführung (Infra-Plan Schritt 6). Forward-only, additiv.
-- Nie editieren; Änderungen als neue Migration.
--
-- ZWECK: Vectorize kann Vektoren nur über ihre IDs löschen/ersetzen — diese
-- Tabelle ist das D1-Verzeichnis der pro Artikel indexierten Chunks (welche
-- IDs existieren, mit welchem Inhalts-Hash). Damit kann der Indexer
-- (src/server/search/indexer.ts):
--   1. beim Re-Publish NUR geänderte Chunks neu embedden (Hash-Vergleich →
--      spart Workers-AI-Kosten, Kosten-Leitplanke),
--   2. verwaiste Vektoren gezielt löschen (Artikel gekürzt/entfernt),
--   3. später die STALENESS generierter Artikel erkennen (Architektur-
--      Entscheidung: generierte Artikel merken sich Quell-Chunks + deren
--      content_hash — dieser Hash lebt genau hier).
--
-- ISOLATION: tenant_id in PK + jede Query; die Vektoren selbst tragen
-- zusätzlich den Tenant als Vectorize-Namespace UND im Metadaten-Feld.

CREATE TABLE search_chunks (
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  article_id   TEXT NOT NULL,
  chunk_index  INTEGER NOT NULL,
  content_hash TEXT NOT NULL,          -- sha256(Chunk-Text) hex
  vector_id    TEXT NOT NULL,          -- ID des Vektors in Vectorize
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, article_id, chunk_index)
);
