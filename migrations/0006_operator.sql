-- 0006 — Operator-Onboarding (Punkt 4b). Forward-only, additiv. Nie editieren.
--
-- ZWECK: Control-Plane der Betreiber-Instanz (`app.hallofhelp.app`). Ein
-- Operator-Konto (eigener, strikt isolierter better-auth-Kontext im Tenant
-- `t_operator`) kann NEUE Hilfezentren (Kunden-Tenants) provisionieren. Jedes
-- provisionierte Hilfezentrum bekommt ein EIGENES Owner-Konto IN diesem neuen
-- Tenant (getrennte auth_user-Zeile, gleiche E-Mail möglich) — die Instanz-
-- Isolation bleibt gewahrt (KEIN Cross-Instance-Login).
--
-- ISOLATIONS-INVARIANTE: `operator_help_centers` ist die EINZIGE bewusste,
-- kontrollierte Cross-Tenant-Referenz im System. Sie wird ausschließlich
-- serverseitig, operator-scoped gelesen/geschrieben (src/server/operator/*):
-- ein Operator sieht/erstellt NUR eigene Hilfezentren. `operator_user_id` ist
-- die auth_user-Id des Operators IN `t_operator` (bewusst OHNE FK — die einzige
-- FK zeigt auf den provisionierten Tenant, nicht kreuz-instanzlich auf User).

CREATE TABLE operator_help_centers (
  operator_user_id TEXT NOT NULL,                       -- auth_user.id in t_operator
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  created_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (operator_user_id, tenant_id)
);
-- „Meine Hilfezentren" listet über den Operator → nach operator_user_id indexiert.
CREATE INDEX idx_operator_help_centers_user ON operator_help_centers (operator_user_id);

-- OPERATOR-TENANT-SEED (dev/staging) — deckt sich mit src/lib/tenant/registry.ts
-- (OPERATOR_TENANT). Der Slug `app` ist reserviert (kein Kunde kann ihn
-- beanspruchen); hier wird er kontrolliert direkt geseedet.
-- PROD: diese Zeile ist real anzulegen (dokumentiert im Report), zusammen mit
-- dem DNS/Routing für app.hallofhelp.app.
INSERT INTO tenants (id, slug, name, default_locale) VALUES
  ('t_operator', 'app', 'HallofHelp', 'de');
