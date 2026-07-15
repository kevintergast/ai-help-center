-- 0009 — Nutzungs-Metering + Plan/Credits (Infra-Plan Schritt 3). Forward-only, additiv.
-- Nie editieren; Änderungen als neue Migration.
--
-- ZWECK: ersetzt die Admin-Fake-Daten (stats/kpi/plan) durch ECHTES Tracking und
-- legt das Fundament des Credit-/Plan-Systems (Preis-BERECHNUNG jetzt, Paddle-
-- Zahlungen später — Billing-Layer bleibt provider-agnostisch).
--
-- ISOLATION: jede Zeile trägt `tenant_id` (REFERENCES tenants ON DELETE CASCADE);
-- zusammengesetzte PKs nach dem Muster von 0005 — Cross-Tenant-Zugriff ist schon
-- auf Schema-Ebene ausgeschlossen, weil jeder Lookup zwingend tenant_id trifft.
--
-- PERIODEN-MODELL (bewusst OHNE Reset-Cron): `period` = UTC-Kalendermonat
-- ('YYYY-MM'). Ein neuer Monat ist schlicht ein NEUER Schlüssel → Zähler starten
-- automatisch bei 0, nichts muss zurückgesetzt werden. Der over_limit→Freeze-
-- Übergang wird LAZY beim Lesen/Verbuchen ausgewertet (plan-state.ts), nicht
-- von einem Scheduler.
--
-- MAU-DEDUP: `usage_mau` hält pro (tenant, period) jede Besucher-Identität genau
-- einmal (INSERT OR IGNORE); die MAU-Zahl ist COUNT(*) darüber — kein doppelt
-- gepflegter Zähler, kein Drift. `visitor_id` ist die pseudonyme Cookie-ID
-- (anon) bzw. 'u:<user_id>' (eingeloggt). Team-Mitglieder (actor_type
-- 'internal') zählen NICHT in MAU/Credits, werden aber als Events erfasst
-- (Statistik-Filter „interne ausblenden", Architektur-Entscheidung 2026-06-28).

-- Append-only-Verbrauchs-/Analytics-Ledger. `credits` steht IM Event (Preis zum
-- Ereigniszeitpunkt aus pricing.ts) — spätere Preisänderungen verfälschen alte
-- Perioden nicht.
CREATE TABLE usage_events (
  id          TEXT NOT NULL,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type        TEXT NOT NULL
                CHECK (type IN ('article_view','ai_generation','ai_regeneration','search')),
  credits     INTEGER NOT NULL DEFAULT 0,
  actor_type  TEXT NOT NULL DEFAULT 'anon'
                CHECK (actor_type IN ('anon','user','internal')),
  visitor_id  TEXT,             -- pseudonyme Cookie-ID bzw. 'u:<user_id>'
  user_id     TEXT,             -- nur bei eingeloggten Nutzern (Filter/Debug)
  article_id  TEXT,             -- bei article_view: (tenant_id, article_id) aus articles
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

-- Zeitfenster-Scans (Statistik, Tagesserien) innerhalb eines Tenants.
CREATE INDEX idx_usage_events_tenant_time ON usage_events (tenant_id, created_at);
-- View-Dedup („gleicher Besucher, gleicher Artikel, letzte 30 min zählt nicht doppelt").
CREATE INDEX idx_usage_events_dedup ON usage_events (tenant_id, visitor_id, article_id, created_at);

-- Monats-Dedup aktiver Besucher (MAU). Truth für die MAU-Zahl (COUNT).
CREATE TABLE usage_mau (
  tenant_id     TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period        TEXT NOT NULL,          -- 'YYYY-MM' (UTC)
  visitor_id    TEXT NOT NULL,
  first_seen_at INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, period, visitor_id)
);

-- Aggregierter Credit-Zähler pro Abrechnungsperiode. Wird ausschließlich über
-- atomare UPSERT-Inkremente geschrieben (credits_used = credits_used + n) —
-- die Wahrheit bleibt rekonstruierbar aus usage_events (SUM(credits)).
CREATE TABLE tenant_usage (
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  period       TEXT NOT NULL,           -- 'YYYY-MM' (UTC)
  credits_used INTEGER NOT NULL DEFAULT 0,
  updated_at   INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, period)
);

-- Plan + Limit-Status je Tenant. Zeile entsteht LAZY (fehlend = Free-Plan).
-- `over_limit_since` markiert den Beginn der 30-Tage-Grace (billing-pricing-
-- Entscheidung); gesetzt/gelöscht wird sie im Verbuchungspfad (store.ts),
-- der Freeze selbst wird lazy aus (since + Grace < now) abgeleitet.
CREATE TABLE tenant_plan (
  tenant_id              TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  plan                   TEXT NOT NULL DEFAULT 'free'
                           CHECK (plan IN ('free','starter','scale')),
  over_limit_since       INTEGER,       -- unixepoch; NULL = im Limit
  over_limit_notified_at INTEGER,       -- für spätere Limit-Mails (einmalig senden)
  updated_at             INTEGER NOT NULL,
  PRIMARY KEY (tenant_id)
);
