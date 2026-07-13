-- 0003 — White-Label-Branding pflegbar: Logo in R2 + Cache-Busting-Version.
-- Forward-only, additiv (expand). Nie editieren; Änderungen als neue Migration.

-- R2-Objektschlüssel des hochgeladenen Logos (fester Key "tenants/<id>/logo").
-- `logo_url` bleibt für extern gehostete Logos bestehen; hat ein Tenant BEIDE,
-- gewinnt der R2-Upload (siehe rowToTenant in src/server/tenant/repository.ts).
ALTER TABLE tenants ADD COLUMN logo_r2_key TEXT;

-- Unix-Timestamp der letzten Branding-Änderung. Dient als Cache-Busting-
-- Version (?v=) der abgeleiteten Logo-URL — das Logo selbst wird mit
-- "immutable" gecacht und per neuem ?v= ausgetauscht.
ALTER TABLE tenants ADD COLUMN branding_updated_at INTEGER;
