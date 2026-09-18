-- 0042 — VERBESSERUNGSVORSCHLAG an einer Meldung.
--
-- Gehört zur KI-Meldung (`kind = 'ai_review'`): Eine KI, die nur „unklar"
-- sagt, erzeugt Arbeit statt sie abzunehmen. Der Vorschlag ist deshalb
-- PFLICHT für diese Art — das hebt die Schwelle und macht die Meldung
-- sofort verwertbar.
--
-- Bei menschlichen Meldungen bleibt die Spalte leer: Von jemandem, der nicht
-- weiterkommt, einen Formulierungsvorschlag zu verlangen wäre absurd.
ALTER TABLE support_tickets ADD COLUMN suggestion TEXT;
