-- 0025 — HEADER-NAME-SCHALTER (White-Label): steuert, ob der Instanzname im
-- Header NEBEN dem Logo steht. Viele Logos tragen den Schriftzug bereits —
-- dann wäre der Name doppelt. 1 = anzeigen (Default/Bestand). Die UI zeigt
-- den Namen IMMER, solange kein Logo gesetzt ist (sonst leerer Header).
-- Forward-only, additiv.
ALTER TABLE tenants ADD COLUMN show_header_name INTEGER NOT NULL DEFAULT 1;
