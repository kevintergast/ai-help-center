-- 0014 — Support-E-Mail pro Instanz (Settings, echte Persistenz).
-- Forward-only, additiv. NULL = nicht konfiguriert: Support-Tickets landen
-- dann NUR in der Admin-Inbox (kein Mail-Versand). Ziel-Adresse des
-- Support-Flows (Architektur: „Etwas stimmt nicht?" → Ticket → Mail an die
-- im Tenant-Admin hinterlegte Support-E-Mail).
ALTER TABLE tenants ADD COLUMN support_email TEXT;
