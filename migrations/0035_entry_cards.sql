-- 0035 — EINSTIEGS-KARTEN der Startansicht.
--
-- WARUM: Unter der KI-Eingabe stand bisher nichts außer Beispielfragen. Wer
-- nicht weiß, was er fragen soll, sieht ein leeres Feld und geht wieder. Die
-- Karten sind der bewusst gesetzte erste Schritt — ein Einstiegsartikel, die
-- Roadmap, die Updates oder ein Ziel außerhalb (Statusseite, Community).
--
-- `kind` + `target` statt vier Spalten: Die Art bestimmt, WIE `target` gelesen
-- wird — 'article' = Slug, 'url' = absolute https-Adresse, 'roadmap' und
-- 'changelog' brauchen gar kein Ziel (deshalb NULL erlaubt). Die Prüfung, dass
-- Art und Ziel zusammenpassen, liegt in lib/content/entry-cards.ts und gilt
-- damit für BEIDE Türen (Verwaltung + MCP) gleich.
--
-- `title` ist Pflicht, `description` optional: Eine Karte ohne Beschriftung
-- wäre eine leere Fläche. Der Artikeltitel wird beim Anlegen vorgeschlagen,
-- aber kopiert — sonst ändert ein umbenannter Artikel unbemerkt die Startseite.
CREATE TABLE entry_cards (
  id          TEXT NOT NULL,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL DEFAULT 'article'
                CHECK (kind IN ('article','roadmap','changelog','url')),
  title       TEXT NOT NULL,
  description TEXT,
  -- Slug (article) bzw. https-Adresse (url); bei roadmap/changelog NULL.
  target      TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX idx_entry_cards_sort ON entry_cards (tenant_id, sort);
