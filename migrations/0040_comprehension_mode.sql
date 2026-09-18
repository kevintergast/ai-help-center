-- 0040 — SCHALTER für „Ich verstehe etwas nicht" (gehört zu 0039).
--
-- Eigene Datei, weil es eine ANDERE Tabelle ist: 0039 erweitert
-- `support_tickets`, hier geht es um `tenants`. Zusammengelegt hätte jede
-- Test-Fixture beide Tabellen gebraucht, auch wenn sie nur eine benutzt.
--
-- Standard AN: Eine Instanz, die keine Rückmeldungen will, schaltet ab — aber
-- der Normalfall ist, sie zu wollen.
-- Der Modus ist White-Label-schaltbar.
ALTER TABLE tenants ADD COLUMN comprehension_mode INTEGER NOT NULL DEFAULT 1;
