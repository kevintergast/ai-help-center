-- 0007 — Plattform-/Operator-Anzeigename auf die Marken-Schreibweise "HallOfHelp".
-- Forward-only, additiv (reine Datenänderung, keine Schemaänderung). Idempotent.
-- Deckt sich mit OPERATOR_TENANT.name in src/lib/tenant/registry.ts. Betrifft NUR
-- die Betreiber-Instanz (t_operator); Kunden-Tenants bleiben unberührt (White-Label).
UPDATE tenants SET name = 'HallOfHelp' WHERE id = 't_operator';
