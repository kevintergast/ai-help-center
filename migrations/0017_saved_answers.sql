-- 0017 — Gespeicherte KI-Antworten im KONTO (Architektur: local-first +
-- optionaler Account-Sync, geräteübergreifend). Forward-only, additiv.
--
-- Die `id` ist die CLIENT-seitige, aus der normalisierten Frage abgeleitete
-- stabile Antwort-Id (saved-articles.ts answerId) — dieselbe Frage überschreibt
-- sich selbst statt zu duplizieren; Merge-Konflikte löst `saved_at`
-- (neuester Speicherstand gewinnt). Strikt tenant- UND user-gebunden
-- (Instanz-Isolation; kein Cross-Tenant-Zugriff möglich).
CREATE TABLE saved_answers (
  tenant_id        TEXT NOT NULL,
  user_id          TEXT NOT NULL,
  id               TEXT NOT NULL,
  question         TEXT NOT NULL,
  body_json        TEXT NOT NULL,             -- string[] (Absätze)
  citations_json   TEXT NOT NULL DEFAULT '[]',-- {id,title}[]
  source_refs_json TEXT NOT NULL DEFAULT '[]',-- SourceRef[] (Staleness-Anker)
  grounded         INTEGER NOT NULL DEFAULT 1,
  saved_at         INTEGER NOT NULL,          -- Client-Zeitstempel (Merge)
  created_at       INTEGER NOT NULL,
  updated_at       INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, user_id, id)
);

CREATE INDEX idx_saved_answers_user
  ON saved_answers (tenant_id, user_id, updated_at DESC);
