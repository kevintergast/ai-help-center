-- 0052 — Klicks auf ZIELE (unsichtbare Oberflächen-Verweise aus KI-Antworten).
--
-- Zweck ist nicht Abrechnung, sondern eine Erkenntnis für den Kunden: WELCHE
-- Stellen seiner Oberfläche findet niemand allein? Dieselbe Schleife wie bei
-- den unbeantworteten Fragen — nur dass hier die Oberfläche antwortet, nicht
-- der Text.
--
-- BEWUSST NICHT in usage_events: Dort hängt an jedem neuen Typ ein kompletter
-- Tabellen-Rebuild (SQLite kann CHECK nicht ändern, s. 0011/0016/0020/0026),
-- und ein Ziel ist eine URL, für die es dort kein Feld gibt.
--
-- AGGREGIERT je (Instanz, Ziel, Tag) statt eine Zeile je Klick: Das hält die
-- Tabelle klein, braucht keine Aufräum-Regel und reicht für die Frage völlig.
-- Keine Besucher-Kennung — wer geklickt hat, ist für diese Auswertung
-- belanglos und wäre nur ein Datum mehr, das wir vorhalten müssten.
CREATE TABLE destination_clicks (
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  href       TEXT NOT NULL,
  day        INTEGER NOT NULL,          -- unixepoch, auf den Tag abgerundet
  clicks     INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, href, day)
);

-- Auswertung „meistgeklickte Ziele der letzten N Tage".
CREATE INDEX idx_destination_clicks_tenant_day ON destination_clicks (tenant_id, day);
