-- 0031 — FAVICON pro Instanz (White-Label): eigener R2-Key für das Emblem,
-- das der Browser im Tab/in Lesezeichen zeigt.
-- NULL = kein eigenes Favicon → es wird AUTOMATISCH das helle Logo verwendet
-- (Kette in src/lib/theme/brand.ts: favicon → Logo → Plattform-Icon).
-- Bewusst eine eigene Spalte statt „Logo ist das Favicon": ein Wortmarken-Logo
-- ist im 16×16-Tab unlesbar — Kunden brauchen ein quadratisches Emblem.
-- Forward-only, additiv.
ALTER TABLE tenants ADD COLUMN favicon_r2_key TEXT;
