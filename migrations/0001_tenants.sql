-- 0001 — White-Label-Fundament: Mandanten + Branding.
-- Forward-only. Nie editieren; Änderungen als neue Migration.

CREATE TABLE tenants (
  id               TEXT PRIMARY KEY,
  slug             TEXT NOT NULL UNIQUE,             -- <slug>.hallofhelp.app
  name             TEXT NOT NULL,
  custom_domain    TEXT UNIQUE,                      -- optionale eigene Domain (Paid)
  default_locale   TEXT NOT NULL DEFAULT 'de',
  logo_url         TEXT,
  color_primary    TEXT NOT NULL DEFAULT '#4f46e5',
  color_accent     TEXT NOT NULL DEFAULT '#06b6d4',
  color_primary_fg TEXT NOT NULL DEFAULT '#ffffff',
  plan             TEXT NOT NULL DEFAULT 'free',
  created_at       INTEGER NOT NULL DEFAULT (unixepoch())
);

CREATE INDEX idx_tenants_custom_domain ON tenants (custom_domain);

-- Demo-Seed (Staging/lokal) — deckt sich mit src/lib/tenant/registry.ts.
INSERT INTO tenants (id, slug, name, default_locale, color_primary, color_accent) VALUES
  ('t_demo', 'demo', 'HallofHelp Demo', 'de', '#4f46e5', '#06b6d4'),
  ('t_acme', 'acme', 'Acme Support',    'en', '#e11d48', '#f59e0b');
