-- 0041 — ERSCHEINUNGSBILD DES WIDGETS.
--
-- Bisher gab es nur `widget_on_site` (an/aus). Der Starter sah damit auf jeder
-- Website gleich aus — in einem White-Label-Produkt die falsche Vorgabe.
--
-- `widget_variant` nutzt DIESELBEN vier Varianten wie die Kopf-Knöpfe
-- (lib/content/action-buttons.ts). Ein Gestaltungsbegriff für beide Flächen:
-- Wer ihn einmal versteht, versteht ihn überall.
--
-- Die Symbole liegen als R2-Schlüssel wie Logo und Favicon — sie gehen durch
-- denselben gehärteten Upload (Typ-Allowlist, Magic-Bytes-Abgleich,
-- Größendeckel, KEIN SVG). Ein eigener Upload-Weg hätte diese Prüfungen
-- dupliziert, und Duplikate driften.
ALTER TABLE tenants ADD COLUMN widget_variant TEXT NOT NULL DEFAULT 'colored'
  CHECK (widget_variant IN ('ghost','outlined','filled','colored'));
-- Beschriftung des geschlossenen Starters; NULL = i18n-Standard.
ALTER TABLE tenants ADD COLUMN widget_label TEXT;
ALTER TABLE tenants ADD COLUMN widget_icon_r2_key TEXT;
ALTER TABLE tenants ADD COLUMN widget_icon_open_r2_key TEXT;
