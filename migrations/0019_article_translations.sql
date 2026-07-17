-- 0019 — Mehrsprachige Artikel als TRANSLATION-SETS (Architektur: stabiler
-- article_key + eine Zeile je Locale, KEINE Duplikat-Artikel). Forward-only.
--
-- Modell: Jede Übersetzung ist eine normale `articles`-Zeile (eigener Slug,
-- eigener Lifecycle, eigener Such-Index-Eintrag → die KI zitiert automatisch
-- die Übersetzung in der Fragesprache). Zusammengehörige Sprachfassungen
-- teilen den `article_key`; Bestand wird auf key = eigene id gesetzt
-- (jeder Alt-Artikel = ein einsprachiges Set).
ALTER TABLE articles ADD COLUMN article_key TEXT;

UPDATE articles SET article_key = id WHERE article_key IS NULL;

-- Ein Set hat höchstens EINE Fassung je Sprache.
CREATE UNIQUE INDEX uq_articles_key_locale ON articles (tenant_id, article_key, locale);

CREATE INDEX idx_articles_key ON articles (tenant_id, article_key);
