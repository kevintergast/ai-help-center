-- 0024 — ARTIKEL-FLAG (Block-Editor-Umbau): optionales Badge je Sprachfassung,
-- z. B. „Beta" oder „Wichtig". JSON {text, color} mit PALETTEN-Farbe
-- (lib/content/blocks.ts TAG_COLORS — kein freies CSS). NULL = kein Flag.
-- Forward-only, additiv.
ALTER TABLE articles ADD COLUMN flag_json TEXT;
