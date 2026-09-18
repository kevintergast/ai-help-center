-- 0039 — „ICH VERSTEHE ETWAS NICHT": Hinweise auf Mängel IM Artikel.
--
-- WARUM NICHT „Etwas stimmt nicht?": Das meldet eine falsche KI-ANTWORT und
-- reist mit der Frage als Kontext. Hier meldet jemand eine Stelle IM ARTIKEL,
-- die er nicht versteht — anderer Anlass, anderer Kontext (welcher Artikel,
-- welcher Block), aber dasselbe Postfach. Ein zweites Postfach hätte bedeutet,
-- dass ein Team zwei Orte im Blick behalten muss.
--
-- Deshalb erweitert diese Migration die BESTEHENDE Tabelle statt eine zweite
-- daneben zu stellen. `kind` trennt die beiden Arten; alles Bestehende bleibt
-- 'support' (Default), es muss nichts nachgetragen werden.
--
-- `anchor` ist der BLOCK-Index, nicht eine Zeichenposition: Eine Markierung
-- über Zeichen bricht, sobald jemand den Text bearbeitet, und der Hinweis
-- zeigt danach ins Leere. Ein Block überlebt Textänderungen.
-- `quote` hält den angeklickten Text fest — falls der Block später verschoben
-- oder gelöscht wird, weiß das Team trotzdem noch, worum es ging.
ALTER TABLE support_tickets ADD COLUMN kind TEXT NOT NULL DEFAULT 'support';
ALTER TABLE support_tickets ADD COLUMN article_id TEXT;
ALTER TABLE support_tickets ADD COLUMN anchor INTEGER;
ALTER TABLE support_tickets ADD COLUMN quote TEXT;
