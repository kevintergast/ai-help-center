-- 0011 — usage_events.type um Feedback-Typen erweitern (Hilfreich-Quote,
-- „War das hilfreich?" zu Artikeln UND KI-Antworten; 0 Credits, kein MAU).
--
-- SQLite kann CHECK-Constraints nicht ändern → forward-only REBUILD mit
-- Datenübernahme (expand/contract): neue Tabelle mit erweitertem CHECK,
-- Daten kopieren, alte Tabelle ersetzen, Indizes identisch neu anlegen.
-- Es referenziert KEINE Tabelle usage_events (nur usage_events → tenants),
-- daher ist der Rebuild gefahrlos.

CREATE TABLE usage_events_v2 (
  id          TEXT NOT NULL,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type        TEXT NOT NULL
                CHECK (type IN ('article_view','ai_generation','ai_regeneration','search',
                                'feedback_helpful','feedback_unhelpful')),
  credits     INTEGER NOT NULL DEFAULT 0,
  actor_type  TEXT NOT NULL DEFAULT 'anon'
                CHECK (actor_type IN ('anon','user','internal')),
  visitor_id  TEXT,             -- pseudonyme Cookie-ID bzw. 'u:<user_id>'
  user_id     TEXT,             -- nur bei eingeloggten Nutzern (Filter/Debug)
  article_id  TEXT,             -- article_view/feedback: (tenant_id, article_id); NULL = KI-Antwort
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

INSERT INTO usage_events_v2 SELECT * FROM usage_events;
DROP TABLE usage_events;
ALTER TABLE usage_events_v2 RENAME TO usage_events;

-- Indizes identisch zu 0009 neu anlegen (gehen mit DROP TABLE verloren):
CREATE INDEX idx_usage_events_tenant_time ON usage_events (tenant_id, created_at);
CREATE INDEX idx_usage_events_dedup ON usage_events (tenant_id, visitor_id, article_id, created_at);
