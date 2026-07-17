-- 0022 — Per-Instanz-RAHMEN (Ops-Verwaltung, primär Enterprise): individuelle
-- Deckel für Credits und MAU. NULL = Plan-Standard aus pricing.ts; gesetzt =
-- Override, der über die GETEILTE Plan-Logik (plan-state.ts) überall wirkt —
-- Produkt-Enforcement (over_limit→Freeze), Kunden-Admin UND Ops zeigen/prüfen
-- dieselben effektiven Werte. Forward-only, additiv.
ALTER TABLE tenant_plan ADD COLUMN custom_included_credits INTEGER;
ALTER TABLE tenant_plan ADD COLUMN custom_mau_limit INTEGER;
