-- 0023 — DUNKLES Logo (White-Label): eigener R2-Key für die Dark-Mode-Variante.
-- NULL = kein dunkles Logo → UI zeigt in Dark Mode das helle (Fallback).
-- Das helle Logo bleibt in logo_r2_key/logo_url (0003). Forward-only, additiv.
ALTER TABLE tenants ADD COLUMN logo_dark_r2_key TEXT;
