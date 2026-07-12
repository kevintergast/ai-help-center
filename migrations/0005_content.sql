-- 0005 — Content-Backend (MVP, single-locale). Forward-only, additiv.
-- Nie editieren; Änderungen als neue Migration.
--
-- ZWECK: ersetzt das bisherige Content-Fake (src/lib/content/fake-repo.ts) durch
-- echte, mandanten-isolierte Persistenz für Hilfe-Artikel, Roadmap und Changelog.
--
-- ISOLATION: jede Zeile trägt `tenant_id` (REFERENCES tenants ON DELETE CASCADE);
-- der PRIMARY KEY ist bewusst COMPOSITE (tenant_id, id) — nicht der (in der Task
-- genannte) globale `id`-PK. Grund: (1) dieselbe fachliche Artikel-ID (z. B. aus
-- dem Demo-Seed) darf pro Tenant existieren, ohne global zu kollidieren;
-- (2) Cross-Tenant-Zugriff ist schon auf Schema-Ebene ausgeschlossen, weil jeder
-- Lookup zwingend (tenant_id, id) trifft. Analog zu `tenant_legal_docs` (0002).
--
-- LOCALE: `locale` ist der VORBEREITUNGSSCHRITT für spätere Übersetzungen. Das MVP
-- ist bewusst single-locale — die UI schaltet die Artikelsprache NICHT um. Volle
-- Translation-Sets (EN+DE je Artikel als verknüpfte Zeilen) sind NICHT Teil dieses
-- Schemas; sie kommen additiv in einer späteren Migration.
--
-- DENORMALISIERUNG (MVP): `videos_json` / `related_ids_json` / `body_json` sind
-- JSON-Textspalten statt eigener Tabellen. Der Zugriff ist immer „ganzer Artikel",
-- es gibt (noch) keine Abfragen über einzelne Videos/Relationen → eigene Tabellen
-- wären verfrühte Normalisierung. Rich-Text-Blöcke (statt string[]) und Media in
-- R2 kommen später; `body_json` ist ein JSON-Array von Absatz-Strings.

CREATE TABLE articles (
  id                TEXT NOT NULL,
  tenant_id         TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  locale            TEXT NOT NULL DEFAULT 'de',
  slug              TEXT NOT NULL,
  title             TEXT NOT NULL,
  category          TEXT NOT NULL,
  status            TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft','published','archived')),
  body_json         TEXT NOT NULL DEFAULT '[]',   -- JSON string[] (Absätze)
  videos_json       TEXT NOT NULL DEFAULT '[]',   -- JSON ArticleVideo[] (description PFLICHT, a11y/KI)
  related_ids_json  TEXT NOT NULL DEFAULT '[]',   -- JSON string[] (Artikel-IDs desselben Tenants)
  reading_minutes   INTEGER NOT NULL DEFAULT 1,
  is_ai_generated   INTEGER NOT NULL DEFAULT 0,   -- 0/1; steuert das "KI-generiert"-Badge
  created_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  updated_at        INTEGER NOT NULL DEFAULT (unixepoch()),
  published_at      INTEGER,                      -- erst mit dem ersten Publish gesetzt
  PRIMARY KEY (tenant_id, id)
);

-- Slug ist je (Tenant, Sprache) eindeutig — der öffentliche Pfad-Identifier.
CREATE UNIQUE INDEX uq_articles_slug ON articles (tenant_id, locale, slug);
-- Der Public-Read filtert hart auf status='published' → deckt den Hot-Path ab.
CREATE INDEX idx_articles_status ON articles (tenant_id, status);

-- Lifecycle-/Audit-Snapshots: bei jedem Update/Publish wird der Artikelstand als
-- JSON eingefroren (forward-only-Disziplin; Basis für ein späteres Rollback-UI).
CREATE TABLE article_versions (
  id            TEXT NOT NULL,
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  article_id    TEXT NOT NULL,
  snapshot_json TEXT NOT NULL,
  author_id     TEXT,                             -- wer den Stand erzeugt hat (kann NULL sein)
  created_at    INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (tenant_id, id),
  FOREIGN KEY (tenant_id, article_id) REFERENCES articles (tenant_id, id) ON DELETE CASCADE
);
CREATE INDEX idx_article_versions_article ON article_versions (tenant_id, article_id);

-- Öffentliche Roadmap (Hilfezentrum-Dialog). Reihenfolge über `sort`.
CREATE TABLE roadmap_items (
  id         TEXT NOT NULL,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'planned'
               CHECK (status IN ('planned','in_progress','shipped')),
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (tenant_id, id)
);

-- Öffentlicher Changelog. `published_at` bestimmt die Anzeigereihenfolge + das
-- (serverseitig via Intl formatierte) Datum-Label.
CREATE TABLE changelog_entries (
  id           TEXT NOT NULL,
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  published_at INTEGER NOT NULL DEFAULT (unixepoch()),
  title        TEXT NOT NULL,
  description  TEXT NOT NULL DEFAULT '',
  created_at   INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX idx_changelog_published ON changelog_entries (tenant_id, published_at);
