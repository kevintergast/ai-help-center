-- 0043 — API-DOKU-LINK wird ein normaler Kopf-Knopf.
--
-- WARUM: Seit 0038 kann jede Instanz eigene Aktions-Knöpfe im Kopf anlegen —
-- mit Beschriftung, Symbol, Ziel und Variante. Der API-Doku-Link war daneben
-- ein Sonderfall mit eigener Spalte, eigener Einstellung und eigener Stelle in
-- der Oberfläche, der genau dasselbe tat. Zwei Mechanismen für eine Sache
-- heißt: doppelte Pflege, doppelte Prüfung, und der Nutzer muss raten, welcher
-- Weg der richtige ist.
--
-- BESTAND WIRD ÜBERNOMMEN, nicht weggeworfen: Wer eine Adresse gepflegt hat,
-- findet sie danach als Knopf wieder — inklusive Symbol und Beschriftung.
-- Eingefügt nur, wo noch Platz ist (Deckel: drei Knöpfe) und wo nicht schon
-- ein Knopf auf dieselbe Adresse zeigt.
INSERT INTO header_actions (id, tenant_id, label, icon, href, variant, sort)
SELECT
  'ha_apidocs_' || t.id,
  t.id,
  'API-Dokumentation',
  'code',
  t.api_docs_url,
  'ghost',
  -- ans Ende, damit bestehende Knöpfe ihre Reihenfolge behalten
  COALESCE((SELECT MAX(sort) + 1 FROM header_actions h WHERE h.tenant_id = t.id), 0)
FROM tenants t
WHERE t.api_docs_url IS NOT NULL
  AND t.api_docs_url <> ''
  AND (SELECT COUNT(*) FROM header_actions h WHERE h.tenant_id = t.id) < 3
  AND NOT EXISTS (
    SELECT 1 FROM header_actions h WHERE h.tenant_id = t.id AND h.href = t.api_docs_url
  );

-- `tenants.api_docs_url` BLEIBT hier stehen — bewusst (forward-only,
-- expand/contract, CLAUDE.md):
--
-- Beim Ausrollen laufen alter und neuer Code für einige Sekunden GLEICHZEITIG
-- gegen dieselbe Datenbank. Nähme diese Migration die Spalte weg, während der
-- noch laufende alte Worker sie abfragt, stürzte er ab. Deshalb zwei Schritte:
--   EXPAND (hier):  Knöpfe anlegen, Spalte stehen lassen — beide Stände laufen.
--   CONTRACT (später): `ALTER TABLE tenants DROP COLUMN api_docs_url;`
--
-- Bedingung fürs Aufräumen: Der Code fragt die Spalte nicht mehr ab (ab diesem
-- Release erfüllt — TenantRow, Spaltenliste und Mapping sind entfernt), UND es
-- läuft kein Deployment mehr, das sie noch kennt. Nach dem nächsten
-- Prod-Deploy ist beides der Fall.
