-- 0018 — Bilder in Artikeln (Content-Werkzeuge R2; Architektur: JEDES Bild
-- trägt eine PFLICHT-Beschreibung — sie ist zugleich Alt-Text (a11y) und
-- KI-Kontext (fließt in die Such-Chunks ein). Forward-only, additiv.
--
-- Ablage: Metadaten hier ({id, description}[]); die Binärdaten liegen in R2
-- unter tenants/<tenant_id>/articles/<article_id>/<image_id> (MEDIA-Binding,
-- Key wird aus den Ids ABGELEITET, nie gespeichert/vom Client bestimmt).
ALTER TABLE articles ADD COLUMN images_json TEXT NOT NULL DEFAULT '[]';
