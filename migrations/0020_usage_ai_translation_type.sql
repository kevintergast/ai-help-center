-- 0020 — usage_events.type um 'ai_translation' erweitern: KI-Übersetzung
-- eines Artikels (bezahltes Team-Feature, 50 Credits flat — auch intern, s.
-- pricing.ts creditsFor; Live-Fund 2026-07-17: Verbuchung scheiterte am
-- CHECK-Constraint).
--
-- SQLite kann CHECK-Constraints nicht ändern → forward-only REBUILD mit
-- Datenübernahme (identisches Muster wie 0011/0016).

CREATE TABLE usage_events_v4 (
  id          TEXT NOT NULL,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type        TEXT NOT NULL
                CHECK (type IN ('article_view','ai_generation','ai_regeneration','search',
                                'feedback_helpful','feedback_unhelpful','ai_source',
                                'ai_translation')),
  credits     INTEGER NOT NULL DEFAULT 0,
  actor_type  TEXT NOT NULL DEFAULT 'anon'
                CHECK (actor_type IN ('anon','user','internal')),
  visitor_id  TEXT,             -- pseudonyme Cookie-ID bzw. 'u:<user_id>'
  user_id     TEXT,             -- nur bei eingeloggten Nutzern (Filter/Debug)
  article_id  TEXT,             -- view/feedback/ai_source/ai_translation: Artikel
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

INSERT INTO usage_events_v4 SELECT * FROM usage_events;
DROP TABLE usage_events;
ALTER TABLE usage_events_v4 RENAME TO usage_events;

-- Indizes identisch neu anlegen (gehen mit DROP TABLE verloren):
CREATE INDEX idx_usage_events_tenant_time ON usage_events (tenant_id, created_at);
CREATE INDEX idx_usage_events_dedup ON usage_events (tenant_id, visitor_id, article_id, created_at);
