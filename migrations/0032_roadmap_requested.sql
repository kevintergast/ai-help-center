-- 0032 — Roadmap-Status um 'requested' erweitern.
--
-- FUND aus der ersten echten Migration eines fremden Hilfezentrums
-- (help.smao.ai → smao.hallofhelp.com, 2026-08-28): Deren Roadmap besteht
-- ausschließlich aus einer Spalte „Angefragt (13)" — Kundenwünsche, die
-- gesammelt, aber noch nicht zugesagt sind. Unsere drei Status kannten das
-- nicht, alle 13 Punkte landeten auf „Geplant" und wurden damit zu einer
-- Zusage, die niemand gegeben hat.
--
-- 'requested' steht VOR 'planned': gehört gesehen, aber nicht eingeplant.
--
-- SQLite kann CHECK-Constraints nicht ändern → forward-only REBUILD mit
-- Datenübernahme (identisches Muster wie 0011/0016/0020/0026).

CREATE TABLE roadmap_items_v2 (
  id         TEXT NOT NULL,
  tenant_id  TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title      TEXT NOT NULL,
  status     TEXT NOT NULL DEFAULT 'planned'
               CHECK (status IN ('requested','planned','in_progress','shipped')),
  sort       INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (tenant_id, id)
);

INSERT INTO roadmap_items_v2 (id, tenant_id, title, status, sort, created_at)
  SELECT id, tenant_id, title, status, sort, created_at FROM roadmap_items;

DROP TABLE roadmap_items;
ALTER TABLE roadmap_items_v2 RENAME TO roadmap_items;
