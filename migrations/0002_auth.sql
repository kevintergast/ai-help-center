-- ============================================================================
-- migrations/0002_auth.sql
-- Better-Auth-Kern, strikt tenant-isoliert & sicherheits-gehärtet.
-- Forward-only. NIE editieren; Änderungen als neue Migration.
-- Kompatibel mit 0001_tenants.sql (tenants(id) existiert).
-- SQLite/D1-Semantik: Booleans als INTEGER 0/1, Zeiten als INTEGER unixepoch().
-- ============================================================================

-- ---------------------------------------------------------------------------
-- USER: UNIQUE(tenant_id, email COLLATE NOCASE) statt global-unique/case-sensitiv.
-- role & pending_role per CHECK gedeckelt (kein Freitext).
-- pending_role: privilegierte Rolle wird erst nach TOTP-Enrollment aktiv (M-2).
-- ---------------------------------------------------------------------------
CREATE TABLE auth_user (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name               TEXT,
  email              TEXT NOT NULL,                          -- app-seitig kanonisiert (trim+lower+NFC)
  email_verified     INTEGER NOT NULL DEFAULT 0,
  image              TEXT,
  role               TEXT NOT NULL DEFAULT 'user'
                       CHECK (role IN ('user','content','admin','owner')),
  pending_role       TEXT
                       CHECK (pending_role IS NULL OR pending_role IN ('content','admin')),
  two_factor_enabled INTEGER NOT NULL DEFAULT 0,
  banned             INTEGER NOT NULL DEFAULT 0,
  ban_reason         TEXT,
  ban_expires        INTEGER,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
-- Case-insensitive Eindeutigkeit je Instanz (A-6):
CREATE UNIQUE INDEX uq_user_tenant_email  ON auth_user (tenant_id, email COLLATE NOCASE);
-- Genau 1 owner je Instanz (Partial-Unique, D1 unterstützt Partial-Index):
CREATE UNIQUE INDEX uq_user_tenant_owner  ON auth_user (tenant_id) WHERE role = 'owner';
CREATE INDEX        idx_user_tenant_role  ON auth_user (tenant_id, role);

-- ---------------------------------------------------------------------------
-- SESSION: tenant_id + mfa_verified + mfa_verified_at (Step-up-Frische, M-5).
-- storeSessionInDatabase:true -> Session auch über tenant-aware Adapter scopebar.
-- ---------------------------------------------------------------------------
CREATE TABLE auth_session (
  id              TEXT PRIMARY KEY,
  tenant_id       TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id         TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  token           TEXT NOT NULL,
  mfa_verified    INTEGER NOT NULL DEFAULT 0,
  mfa_verified_at INTEGER,
  ip_address      TEXT,
  user_agent      TEXT,
  expires_at      INTEGER NOT NULL,
  created_at      INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at      INTEGER NOT NULL DEFAULT (unixepoch())
);
-- Token nur je Instanz eindeutig (kein globaler UNIQUE mehr, T-2):
CREATE UNIQUE INDEX uq_session_tenant_token ON auth_session (tenant_id, token);
CREATE INDEX        idx_session_user        ON auth_session (user_id);
CREATE INDEX        idx_session_tenant      ON auth_session (tenant_id);

-- ---------------------------------------------------------------------------
-- ACCOUNT: UNIQUE(tenant_id, provider_id, account_id) -> Social pro Instanz getrennt.
-- ---------------------------------------------------------------------------
CREATE TABLE auth_account (
  id                       TEXT PRIMARY KEY,
  tenant_id                TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id                  TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  account_id               TEXT NOT NULL,
  provider_id              TEXT NOT NULL,
  access_token             TEXT,
  refresh_token            TEXT,
  access_token_expires_at  INTEGER,
  refresh_token_expires_at INTEGER,
  scope                    TEXT,
  id_token                 TEXT,
  password                 TEXT,                              -- argon2id; returned:false
  created_at               INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at               INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX uq_account_tenant_provider
  ON auth_account (tenant_id, provider_id, account_id);
CREATE INDEX idx_account_user ON auth_account (user_id);

-- ---------------------------------------------------------------------------
-- VERIFICATION: tenant_id trägt die Bindung SELBST; beim Einlösen gegen den
-- aufgelösten Host-Tenant prüfen (A-8), nicht nur host-abgeleitet scopen.
-- ---------------------------------------------------------------------------
CREATE TABLE auth_verification (
  id         TEXT PRIMARY KEY,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  identifier TEXT NOT NULL,                                  -- E-Mail kanonisiert
  value      TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_verification_tenant_ident ON auth_verification (tenant_id, identifier);

-- ---------------------------------------------------------------------------
-- TWO_FACTOR: secret + backup codes (verschlüsselt), tenant-isoliert via user.
-- ---------------------------------------------------------------------------
CREATE TABLE auth_two_factor (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id      TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  secret       TEXT NOT NULL,
  backup_codes TEXT NOT NULL,
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_2fa_user ON auth_two_factor (user_id);

-- ---------------------------------------------------------------------------
-- TRUSTED_DEVICE: explizit modelliert, um Tokens bei Rollen-/MFA-Change gezielt
-- zu invalidieren (M-3). Für Team-Rollen serverseitig gar nicht erst angelegt.
-- ---------------------------------------------------------------------------
CREATE TABLE auth_trusted_device (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id     TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  token_hash  TEXT NOT NULL,
  expires_at  INTEGER NOT NULL,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE UNIQUE INDEX uq_trusted_device ON auth_trusted_device (tenant_id, token_hash);
CREATE INDEX        idx_trusted_device_user ON auth_trusted_device (user_id);

-- ---------------------------------------------------------------------------
-- INVITATION: eigen, tenant-scoped, single-use, zeitlich begrenzt.
-- role per CHECK auf content|admin begrenzt -> 'owner' als Invite unmöglich (P-2).
-- Token-Lookup ausschließlich über Composite (tenant_id, token_hash) (T-4).
-- ---------------------------------------------------------------------------
CREATE TABLE auth_invitation (
  id           TEXT PRIMARY KEY,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  email        TEXT NOT NULL,                                -- kanonisiert
  role         TEXT NOT NULL CHECK (role IN ('content','admin')),
  token_hash   TEXT NOT NULL,                                -- sha256(secret)
  inviter_id   TEXT NOT NULL REFERENCES auth_user(id) ON DELETE CASCADE,
  status       TEXT NOT NULL DEFAULT 'pending'
                 CHECK (status IN ('pending','accepted','revoked','expired')),
  expires_at   INTEGER NOT NULL,
  accepted_by  TEXT REFERENCES auth_user(id),
  created_at   INTEGER NOT NULL DEFAULT (unixepoch())
);
-- Token nur im eigenen Namespace auflösbar (T-4):
CREATE UNIQUE INDEX uq_invitation_tenant_token ON auth_invitation (tenant_id, token_hash);
-- höchstens 1 offene Einladung je (Instanz, E-Mail, case-insensitiv):
CREATE UNIQUE INDEX uq_invitation_pending
  ON auth_invitation (tenant_id, email COLLATE NOCASE) WHERE status = 'pending';
CREATE INDEX idx_invitation_tenant ON auth_invitation (tenant_id);

-- ---------------------------------------------------------------------------
-- AUDIT-LOG: sicherheitsrelevante Aktionen, tenant-scoped, append-only.
-- Reads laufen durch den Tenant-Scoping-Helper (T-4).
-- ---------------------------------------------------------------------------
CREATE TABLE auth_audit_log (
  id          TEXT PRIMARY KEY,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  actor_id    TEXT,                                          -- NULL bei anonym/System
  action      TEXT NOT NULL,                                 -- login.success, role.change, ...
  target_id   TEXT,
  ip_address  TEXT,
  user_agent  TEXT,
  metadata    TEXT,                                          -- JSON
  created_at  INTEGER NOT NULL DEFAULT (unixepoch())
);
CREATE INDEX idx_audit_tenant_time ON auth_audit_log (tenant_id, created_at);

-- ---------------------------------------------------------------------------
-- LEGAL-DOCS pro Instanz (§h).
-- ---------------------------------------------------------------------------
CREATE TABLE tenant_legal_docs (
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  doc_type    TEXT NOT NULL CHECK (doc_type IN ('imprint','privacy','terms')),
  mode        TEXT NOT NULL CHECK (mode IN ('link','markdown')),
  url         TEXT,
  markdown    TEXT,
  updated_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (tenant_id, doc_type)
);

-- ---------------------------------------------------------------------------
-- CUSTOM-DOMAIN-LIFECYCLE (A-7): TXT-Ownership-Proof + Re-Validierung.
-- Auflösung aktiv NUR bei status='verified'; sonst fail-closed abgewiesen.
-- Ersetzt die Nutzung von tenants.custom_domain für die Auth-Auflösung.
-- ---------------------------------------------------------------------------
CREATE TABLE tenant_domain (
  id                 TEXT PRIMARY KEY,
  tenant_id          TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  domain             TEXT NOT NULL,
  verification_token TEXT NOT NULL,                          -- erwarteter TXT-Wert
  status             TEXT NOT NULL DEFAULT 'pending'
                       CHECK (status IN ('pending','verified','revoked')),
  verified_at        INTEGER,
  last_checked_at    INTEGER,
  created_at         INTEGER NOT NULL DEFAULT (unixepoch())
);
-- Eine Domain global nur einmal beanspruchbar (verhindert Domain-Hijack-Doppelmapping):
CREATE UNIQUE INDEX uq_tenant_domain_domain ON tenant_domain (domain);
CREATE INDEX        idx_tenant_domain_tenant ON tenant_domain (tenant_id);
-- Nur verifizierte Domains sind für die Auflösung relevant:
CREATE INDEX        idx_tenant_domain_verified ON tenant_domain (domain) WHERE status = 'verified';
