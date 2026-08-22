-- 0030 — VERSIONSNUMMER + STUFE am Changelog-Eintrag (Kunden-Feature).
-- Forward-only, additiv. Nie editieren; Änderungen als neue Migration.
--
-- ZWECK: Jeder Kunde soll den Changelog SEINES Produkts pflegen können — mit
-- eigener Versionsnummer („2.4.0", „R25-08", „Frühjahr 2026") und optional der
-- Art des Updates. Beides ist bewusst OPTIONAL: Wer ohne Versionen arbeitet,
-- sieht davon nichts.
--
--  * version — FREIER Text (max. 32 Zeichen in der App-Validierung). Kein
--    SemVer-Zwang: Kundenschemata sind vielfältig, und ein zu strenges Feld
--    zwingt zu Krücken.
--  * level   — Stufe des Updates für Badge/Filter. CHECK erlaubt NULL, damit
--    Bestandseinträge gültig bleiben und „ohne Angabe" ein echter Zustand ist.
ALTER TABLE changelog_entries ADD COLUMN version TEXT;
ALTER TABLE changelog_entries ADD COLUMN level TEXT
  CHECK (level IS NULL OR level IN ('major', 'minor', 'patch'));
