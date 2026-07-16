-- 0013 — Per-Instanz-Schalter „Suchmaschinen-Indexierung" (SEO-Opt-out).
-- Forward-only, additiv. Default 1 = indexierbar (öffentliche Hilfezentren
-- SOLLEN ranken — Architektur); 0 = noindex: robots.txt Disallow-all, leere
-- sitemap.xml, <meta name="robots" content="noindex">, raus aus dem zentralen
-- Sitemap-Index (sitemap-index.xml). Für Kunden, die ihr Hilfezentrum nicht
-- öffentlich auffindbar wollen (z. B. interne Dokumentation).
ALTER TABLE tenants ADD COLUMN seo_indexable INTEGER NOT NULL DEFAULT 1;
