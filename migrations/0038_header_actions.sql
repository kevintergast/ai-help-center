-- 0038 — AKTIONS-KNÖPFE im Kopf des Hilfezentrums.
--
-- WARUM: Der Kopf trug bisher nur, was WIR vorgesehen hatten (Theme, Konto,
-- API-Doku). Jede Instanz hat aber ihre eine Handlung, die überall erreichbar
-- sein soll — Termin buchen, Status-Seite, Demo anfragen. Ohne diese Fläche
-- landet so ein Verweis in einem Artikel, wo ihn niemand sucht.
--
-- KEINE freie Farbe: `variant` bestimmt das Aussehen, und `colored` nimmt die
-- Marken-Farbe der Instanz. Ein freier Farbwähler daneben könnte einen Knopf
-- erzeugen, dessen Schrift auf der eigenen Fläche nicht mehr lesbar ist.
--
-- `icon` ist ein NAME aus demselben Katalog wie die Artikel-Symbole
-- (lib/content/article-icons.ts) — ein Strich für die ganze Oberfläche.
CREATE TABLE header_actions (
  id         TEXT NOT NULL,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  icon       TEXT,
  -- https-Adresse oder instanz-interner Pfad; geprüft in action-buttons.ts.
  href       TEXT NOT NULL,
  variant    TEXT NOT NULL DEFAULT 'outlined'
               CHECK (variant IN ('ghost','outlined','filled','colored')),
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX idx_header_actions_sort ON header_actions (tenant_id, sort);
