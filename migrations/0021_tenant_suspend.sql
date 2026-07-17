-- 0021 — Instanz-Sperre (Ops-Verwaltung): `suspended_at` gesetzt = Instanz
-- BLOCKIERT. Wirkung an EINEM Punkt: die Host→Tenant-Auflösung
-- (D1TenantRepository) behandelt gesperrte Instanzen wie nicht existent →
-- Hilfezentrum, Admin, Auth, API und Widget antworten 404 (fail-closed,
-- nichts wird gelöscht). Entsperren = Feld auf NULL. Forward-only, additiv.
ALTER TABLE tenants ADD COLUMN suspended_at INTEGER;
