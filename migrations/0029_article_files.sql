-- 0029 — DATEI-ANHÄNGE am Artikel (Vorlagen, Formulare, Checklisten).
-- Forward-only, additiv. Nie editieren; Änderungen als neue Migration.
--
-- Referenz-Hilfezentren (Intercom: PDF/CSV/…; Zendesk: Anhänge) bieten den
-- Download als eigenen Baustein. Struktur wie images_json (0018): Metadaten
-- als JSON-Array in der Artikel-Zeile, Binärdatei in R2 unter einem Key, der
-- IMMER serverseitig aus tenant+article+file abgeleitet wird (kein Key aus
-- Nutzereingabe). Ein Eintrag: { id, name, size, mime }.
ALTER TABLE articles ADD COLUMN files_json TEXT NOT NULL DEFAULT '[]';
