-- 0027 — API-KEYS: Maschinen-Zugang (MCP-Server, später öffentliche REST-API).
-- Forward-only, additiv. Nie editieren; Änderungen als neue Migration.
--
-- ZWECK: Ein Agent kann kein TOTP tippen — die Team-Guards (auth/guards.ts)
-- verlangen aber zu Recht MFA. Ein API-Key ist deshalb ein EIGENER, strikt
-- schwächerer Prinzipal: er entsteht nur aus einer MFA-verifizierten
-- admin/owner-Session, trägt explizit gewählte Scopes und erreicht niemals
-- Team/Ownership, Rechtstexte, Domain, Plan oder die Key-Verwaltung selbst
-- (Begründung + Scope-Katalog: docs/mcp-plan.md §4 E4, §5).
--
-- ISOLATION: `tenant_id` in PK UND in jedem Lookup (Muster 0005/0009). Ein
-- Schlüssel von Tenant A ist auf dem Host von Tenant B schlicht unbekannt —
-- Cross-Tenant-Nutzung scheitert an der WHERE-Klausel, nicht an Anwendungslogik.
--
-- GEHEIMNIS: gespeichert wird NUR SHA-256(Klartext) plus die ersten Zeichen zur
-- Wiedererkennung. Der Klartext existiert genau einmal — in der Antwort des
-- Erzeugens. Ein DB-Leak gibt keine benutzbaren Schlüssel her.
-- (SHA-256 ohne KDF ist hier korrekt: der Schlüssel ist ein 240-Bit-Zufallswert,
-- kein menschliches Passwort — es gibt nichts zu erraten, nur zu suchen.)

CREATE TABLE api_key (
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id           TEXT NOT NULL,
  name         TEXT NOT NULL,              -- vom Nutzer vergeben ("Claude Code, Redaktion")
  key_hash     TEXT NOT NULL,              -- SHA-256(Klartext), hex
  key_prefix   TEXT NOT NULL,              -- erste 12 Zeichen, nur Anzeige/Wiedererkennung
  scopes       TEXT NOT NULL,              -- JSON-Array, validiert gegen apikeys/scopes.ts
  created_by   TEXT,                       -- auth_user.id; NULL wenn das Konto später weg ist
  created_at   INTEGER NOT NULL,           -- unixepoch (Sekunden)
  expires_at   INTEGER NOT NULL,           -- unixepoch; PFLICHT (kein unbefristeter Schlüssel)
  last_used_at INTEGER,                    -- gedrosselt aktualisiert (max. 1x/Minute)
  revoked_at   INTEGER,                    -- gesetzt = sofort ungültig
  PRIMARY KEY (tenant_id, id)
);

-- Auth-Pfad: Lookup ausschließlich über (tenant_id, key_hash).
CREATE UNIQUE INDEX idx_api_key_hash ON api_key (tenant_id, key_hash);
-- Liste im Admin (neueste zuerst).
CREATE INDEX idx_api_key_tenant ON api_key (tenant_id, created_at);
