-- 0037 — KONTAKTWEGE (Seite `/contact`).
--
-- WARUM: Wenn die KI-Antwort und die Artikel nicht weiterhelfen, endete der
-- Weg bisher im Nichts — außer unter einer KI-Antwort, wo ein Ticket-Formular
-- aufklappt. Wer über die Navigation kommt, fand gar nichts. Jetzt kann jede
-- Instanz ihre echten Wege pflegen: Adresse, Telefon, Formular.
--
-- `kind` + `value`: Die Art bestimmt, WIE `value` gelesen wird — 'email' eine
-- Adresse, 'phone' eine Nummer, 'form' braucht keinen Wert (die Seite rendert
-- dort das Ticket-Formular, das schon existiert). Die Prüfung liegt in
-- lib/content/contact-methods.ts und gilt damit für jede Tür gleich.
--
-- KEIN separater „Kontaktseite anzeigen"-Schalter: Der Link erscheint genau
-- dann, wenn mindestens ein Weg gepflegt ist. Ein zweiter Schalter wäre eine
-- zweite Wahrheit, die mit dieser Tabelle aus dem Tritt geraten kann —
-- „eingeschaltet, aber leer" wäre eine Seite, die nichts anbietet.
CREATE TABLE contact_methods (
  id          TEXT NOT NULL,
  tenant_id   TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  kind        TEXT NOT NULL CHECK (kind IN ('email','phone','form')),
  title       TEXT NOT NULL,
  description TEXT,
  -- Adresse (email) bzw. Rufnummer (phone); bei 'form' NULL.
  value       TEXT,
  sort        INTEGER NOT NULL DEFAULT 0,
  created_at  INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (tenant_id, id)
);

CREATE INDEX idx_contact_methods_sort ON contact_methods (tenant_id, sort);
