-- 0012 — Enterprise-Plan (Entscheidung 2026-07-16):
--  (a) tenant_plan.plan-CHECK um 'enterprise' erweitern. SQLite kann CHECKs
--      nicht ändern → forward-only REBUILD mit Datenübernahme (Muster 0011).
--      tenant_plan wird von nichts referenziert (nur → tenants), Rebuild ist
--      gefahrlos.
--  (b) Betreiber-Instanz t_operator auf 'enterprise' setzen (UPSERT — Zeile
--      entsteht sonst erst lazy beim over_limit-Marker). Damit zeigt die
--      Plan-Seite dort EXAKT die Kunden-Berechnungen (Credits/MAU/Overage,
--      „Gefühl für Kosten") mit Enterprise-Limits — ohne Freeze-Risiko fürs
--      öffentliche Schaufenster und OHNE Code-Sonderbehandlung.
--      tenants.plan wird kosmetisch mitgezogen (Billing liest tenant_plan).

CREATE TABLE tenant_plan_v2 (
  tenant_id              TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan                   TEXT NOT NULL DEFAULT 'free'
                           CHECK (plan IN ('free','starter','scale','enterprise')),
  over_limit_since       INTEGER,       -- unixepoch; NULL = im Limit
  over_limit_notified_at INTEGER,       -- für spätere Limit-Mails (einmalig senden)
  updated_at             INTEGER NOT NULL,
  PRIMARY KEY (tenant_id)
);

INSERT INTO tenant_plan_v2 SELECT * FROM tenant_plan;
DROP TABLE tenant_plan;
ALTER TABLE tenant_plan_v2 RENAME TO tenant_plan;

-- INSERT..SELECT statt VALUES: greift NUR, wenn t_operator existiert (Test-
-- Datenbanken wenden 0006/Seeds nicht immer an — FK-sicher, idempotent).
INSERT INTO tenant_plan (tenant_id, plan, updated_at)
SELECT id, 'enterprise', unixepoch() FROM tenants WHERE id = 't_operator'
ON CONFLICT (tenant_id)
DO UPDATE SET plan = 'enterprise', updated_at = unixepoch();

UPDATE tenants SET plan = 'enterprise' WHERE id = 't_operator';
