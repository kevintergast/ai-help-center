-- 0044 — FRAGE-VORSCHLÄGE unter der KI-Eingabe.
--
-- WARUM: Bisher standen dort für JEDE Instanz dieselben drei Beispielfragen
-- aus einem festen Array („Wie binde ich das Widget ein?"). Auf einer
-- Kundeninstanz sind das die Fragen UNSERES Produkts — im White-Label ein
-- Fremdkörper, der obendrein nichts beantwortet, was der Kunde anbietet.
--
-- Die Vorschläge sind das erste, was jemand liest, der nicht weiß, was er
-- fragen soll. Sie gehören dem Betreiber.
--
-- 0 BIS 4: Keine ist erlaubt (dann bleibt die Eingabe schlicht), mehr als vier
-- füllen die Fläche zu und lesen sich als Menü statt als Anregung.
CREATE TABLE prompt_suggestions (
  id         TEXT NOT NULL,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  text       TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX idx_prompt_suggestions_sort ON prompt_suggestions (tenant_id, sort);
