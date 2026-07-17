-- 0015 — Support-Tickets (Support-Flow, Architektur 2026-06-28):
-- Endnutzer → Tenant. „Etwas stimmt nicht?" im Hilfezentrum erzeugt ein
-- Ticket; zusätzlich Mail an tenants.support_email (0014), die Inbox im
-- Admin ist der verlustfreie Fallback. Tenant-isoliert wie alles (CASCADE).
CREATE TABLE support_tickets (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  -- Problembeschreibung des Nutzers (Länge API-seitig begrenzt).
  message TEXT NOT NULL,
  -- Optionale Rückmelde-Adresse des Endnutzers (anonyme Nutzung ist Normalfall).
  contact_email TEXT,
  -- Ursprüngliche Frage an die KI (Triage-Kontext), falls vorhanden.
  question TEXT,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'done')),
  -- Zuordnung wie usage_events (anon|user|internal + pseudonyme Besucher-Id).
  actor_type TEXT NOT NULL DEFAULT 'anon',
  visitor_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);

-- Inbox-Query: offene zuerst, neueste oben — ein Index deckt beides.
CREATE INDEX idx_support_tickets_tenant_status_time
  ON support_tickets (tenant_id, status, created_at DESC);
