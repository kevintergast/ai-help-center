-- 0047 — UNBEANTWORTETE FRAGEN sammeln (Redaktions-Warteschlange).
--
-- WARUM: Bisher endete eine nicht geerdete KI-Frage im Nichts. `ask.ts` kehrte
-- zurück, ohne irgendetwas zu verbuchen — es gab nur eine Konsolenzeile, und
-- die enthielt bewusst NIE den Fragetext. Damit konnte niemand sehen, was
-- Nutzer vergeblich gefragt haben. Wie sehr das fehlte, sieht man im
-- Ops-Rechner: dort ist „KI-Fragen ohne Antwort" ein Feld zum SCHÄTZEN.
--
-- BEWUSSTE ABKEHR von „Fragetexte werden nicht gespeichert" (Entscheidung
-- Kevin, 2026-09-22) — und zwar NUR für Fragen ohne Antwort. Für beantwortete
-- Fragen bleibt es dabei: dort zählen wir weiterhin nur, welche Artikel die
-- Antwort gespeist haben (ai_source-Events), nie den Wortlaut. Der Unterschied
-- ist begründbar: Eine unbeantwortete Frage IST die Information — ohne ihren
-- Wortlaut weiß die Redaktion nicht, was zu schreiben ist.
--
-- AUFBEWAHRUNG: 90 Tage, durchgesetzt beim Schreiben (siehe
-- server/unanswered/store.ts). Kein Cron nötig — die Tabelle wächst nur, wenn
-- gefragt wird, und genau dann wird auch aufgeräumt.
CREATE TABLE unanswered_questions (
  id         TEXT NOT NULL,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Wortlaut der Frage (gekappt) — die Redaktions-Information.
  question   TEXT NOT NULL,
  -- Normalisierte Fassung (klein, Satzzeichen/Mehrfach-Leerzeichen weg):
  -- Gruppierung „dieselbe Frage, mehrfach gestellt" ohne Ähnlichkeitsrechnung
  -- in der Liste. Bewusst simpel — es geht um Häufung, nicht um Semantik.
  question_key TEXT NOT NULL,
  -- 1 = Nutzer hat aktiv „Ich brauche dazu eine Antwort" gedrückt. Das trennt
  -- „ist halt passiert" von „jemand wartet darauf" und ist der Grund, warum
  -- die Liste nicht nur ein Protokoll, sondern eine Warteschlange ist.
  reported   INTEGER NOT NULL DEFAULT 0,
  -- Freiwillige Rückmelde-Adresse (nur beim Melden, nie automatisch).
  contact_email TEXT,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (tenant_id, id)
);

-- Gruppierung/Häufigkeit je Instanz.
CREATE INDEX idx_unanswered_key ON unanswered_questions (tenant_id, question_key);
-- Aufräumen + „zuletzt gefragt".
CREATE INDEX idx_unanswered_created ON unanswered_questions (tenant_id, created_at);
