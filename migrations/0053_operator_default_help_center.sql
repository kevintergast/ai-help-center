-- 0053 — Welches Hilfezentrum meint ein Leser der OPERATOR-Instanz?
--
-- Unsere eigenen Artikel beschreiben Handgriffe im Verwaltungsbereich und
-- hinterlegen dafür Ziele wie `/admin/team`. Auf app.hallofhelp.com zeigen die
-- aber auf UNSEREN Verwaltungsbereich — der Leser landete im Nichts (404).
-- Gemeint ist immer SEIN Hilfezentrum: https://seinefirma.hallofhelp.com/...
--
-- Hat jemand mehrere, muss er einmal wählen. Die Wahl gehört ans KONTO und
-- nicht in den Browser: „einmalig wählen" soll auch für das zweite Gerät
-- gelten.
--
-- Eigene Tabelle statt einer Spalte an `auth_user`: Die Nutzertabelle ist
-- mandantenübergreifend, und eine Spalte, die nur für Operator-Konten eine
-- Bedeutung hat, wäre für alle anderen totes Gewicht. Eine Zeile je Nutzer,
-- der Primärschlüssel erzwingt die Eindeutigkeit ohne Zusatzlogik.
CREATE TABLE operator_default_help_center (
  operator_user_id TEXT NOT NULL,                        -- auth_user.id in t_operator
  tenant_id        TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  updated_at       INTEGER NOT NULL DEFAULT (unixepoch()),
  PRIMARY KEY (operator_user_id)
);
