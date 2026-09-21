-- 0046 — FUSS DES HILFEZENTRUMS: Rechtstexte schaltbar, eigene Links frei.
--
-- WARUM: Der Fuß trug drei fest verdrahtete Links (Impressum/Datenschutz/AGB)
-- auf JEDER Instanz — auch wenn dahinter nichts stand. Dann las der Besucher
-- „… hat diesen Rechtstext noch nicht hinterlegt", was nach kaputtem Produkt
-- aussieht statt nach Rechtstext. Und umgekehrt fehlte jeder Instanz genau
-- der Link, den SIE braucht (Status-Seite, Hauptwebsite, Barrierefreiheit).
--
-- RECHTLICHER HINTERGRUND für die Voreinstellung: Nur die
-- Datenschutzerklärung ist überall nötig (Art. 13 DSGVO greift, sobald
-- personenbezogene Daten verarbeitet werden — auf jeder Instanz der Fall).
-- Das Impressum ist DACH-Pflicht (§5 DDG, ECG, UWG), AGB sind gar keine
-- Pflicht: im Hilfezentrum wird kein Vertrag geschlossen. Trotzdem stehen
-- ALLE DREI auf DEFAULT 1 — nicht weil sie überall Pflicht wären, sondern
-- damit bestehende Instanzen nach der Migration exakt so aussehen wie vorher.
-- Abschalten ist eine bewusste Handlung, kein Nebeneffekt eines Updates.
ALTER TABLE tenants ADD COLUMN footer_imprint INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tenants ADD COLUMN footer_privacy INTEGER NOT NULL DEFAULT 1;
ALTER TABLE tenants ADD COLUMN footer_terms   INTEGER NOT NULL DEFAULT 1;

-- „Powered by"-Hinweis. DEFAULT 0: Ein Update darf auf einer laufenden
-- Kundeninstanz nicht unangekündigt UNSEREN Namen einblenden. Die Plan-Regel
-- (im Gratis-Plan verpflichtend) kommt mit dem Billing, nicht hier.
ALTER TABLE tenants ADD COLUMN footer_powered_by INTEGER NOT NULL DEFAULT 0;

-- EIGENE Links. Bewusst dieselbe Form wie header_actions (0038): (tenant_id,
-- id) als PK — dieselbe fachliche Id darf pro Tenant existieren, und jeder
-- Lookup trifft zwingend den Mandanten. Kein `variant`/`icon` wie oben: der
-- Fuß ist eine ruhige Textzeile, kein zweites Knopfband.
CREATE TABLE footer_links (
  id         TEXT NOT NULL,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  label      TEXT NOT NULL,
  -- https-Adresse oder instanz-interner Pfad; geprüft in action-buttons.ts
  -- (dieselbe Regel wie die Kopf-Knöpfe).
  href       TEXT NOT NULL,
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX idx_footer_links_sort ON footer_links (tenant_id, sort);
