-- 0008 — Plattform-/Operator-Anzeigename auf die endgültige Schreibweise "Hall Of Help".
-- Forward-only, additiv (reine Datenänderung). Idempotent. Betrifft NUR t_operator;
-- Kunden-Tenants bleiben unberührt (White-Label). Deckt sich mit registry.ts.
UPDATE tenants SET name = 'Hall Of Help' WHERE id = 't_operator';
