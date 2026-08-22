-- 0026 — usage_events.type um 'ai_video_summary' erweitern: KI-Aufbereitung
-- eines Video-Transkripts zu Titel + Beschreibung (bezahltes Team-Feature,
-- s. pricing.ts creditsFor — wie ai_translation IMMER voller Preis, weil
-- team-exklusiv). Verbucht wird NUR bei Erfolg.
--
-- SQLite kann CHECK-Constraints nicht ändern → forward-only REBUILD mit
-- Datenübernahme (identisches Muster wie 0011/0016/0020).

CREATE TABLE usage_events_v5 (
  id          TEXT NOT NULL,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  type        TEXT NOT NULL
                CHECK (type IN ('article_view','ai_generation','ai_regeneration','search',
                                'feedback_helpful','feedback_unhelpful','ai_source',
                                'ai_translation','ai_video_summary')),
  credits     INTEGER NOT NULL DEFAULT 0,
  actor_type  TEXT NOT NULL DEFAULT 'anon'
                CHECK (actor_type IN ('anon','user','internal')),
  visitor_id  TEXT,             -- pseudonyme Cookie-ID bzw. 'u:<user_id>'
  user_id     TEXT,             -- nur bei eingeloggten Nutzern (Filter/Debug)
  article_id  TEXT,             -- view/feedback/ai_source/ai_translation: Artikel
                                -- (ai_video_summary: NULL — noch kein Artikel-Bezug,
                                --  die Aufbereitung läuft im Editor vor dem Speichern)
  created_at  INTEGER NOT NULL,
  PRIMARY KEY (tenant_id, id)
);

INSERT INTO usage_events_v5 SELECT * FROM usage_events;
DROP TABLE usage_events;
ALTER TABLE usage_events_v5 RENAME TO usage_events;

-- Indizes identisch neu anlegen (gehen mit DROP TABLE verloren):
CREATE INDEX idx_usage_events_tenant_time ON usage_events (tenant_id, created_at);
CREATE INDEX idx_usage_events_dedup ON usage_events (tenant_id, visitor_id, article_id, created_at);
