-- 0034 — NAVIGATIONS-REIHENFOLGE der Artikel.
--
-- WARUM: Die linke Leiste sortierte nach `created_at` — also nach dem Zufall
-- der Anlage. „Erste Schritte" landete damit irgendwo zwischen den
-- Integrationen. Eine Hilfe liest man aber in einer Reihenfolge.
--
-- EINE Zahl für ZWEI Ebenen: Artikel werden nach `sort` ausgegeben, und die
-- Kategorien erben ihre Reihenfolge aus dem ersten Artikel, der in ihnen
-- vorkommt (groupByCategory bewahrt die Eingangsreihenfolge). Damit genügt
-- eine einzige durchlaufende Nummerierung — keine zweite Tabelle für
-- Kategorie-Positionen, die mit der Artikelliste aus dem Tritt geraten kann.
--
-- DEFAULT 0: Bestandsartikel behalten ihre bisherige Ordnung, weil `created_at`
-- als zweites Sortierkriterium stehen bleibt. Ohne Pflege ändert sich nichts.
-- Forward-only, additiv.
ALTER TABLE articles ADD COLUMN sort INTEGER NOT NULL DEFAULT 0;

-- Die Navigation liest je Mandant + Sprache; der Index bedient genau das.
CREATE INDEX IF NOT EXISTS idx_articles_sort ON articles (tenant_id, locale, sort);
