-- Strukturierte KI-Antworten (Bausteine) im Konto-Sync.
--
-- Bisher wurde eine gespeicherte Antwort als Absatz-Liste abgelegt. Der
-- dynamische Hilfeartikel kennt jetzt Bausteine (Absatz, Schritt, Bild) mit
-- je einer Quelle. Ohne diese Spalte verlöre eine Antwort beim Sync ins Konto
-- genau das, was sie lesbar macht: Reihenfolge der Schritte und Bilder.
--
-- Additiv und optional: Alte Zeilen haben NULL und rendern weiter aus
-- body_json — der Anzeige-Pfad dafür bleibt bestehen.
ALTER TABLE saved_answers ADD COLUMN parts_json TEXT;
