# Changelog

Alle nennenswerten Änderungen an HallofHelp — technische Sicht, nach
[Keep a Changelog](https://keepachangelog.com/de/1.1.0/) und
[Semantic Versioning](https://semver.org/lang/de/).

**Wie das hier zusammenhängt** (Details: [docs/versioning.md](docs/versioning.md)):

- `package.json` → `version` ist die **Quelle der Wahrheit**; jeder Release trägt
  einen Git-Tag `vX.Y.Z`.
- Was **läuft**, fragt man beim Deployment selbst ab: `pnpm version:deployed`
  bzw. `GET /api/v1/health` (liefert Version, Commit, Build-Zeit, Umgebung).
- Diese Liste ist die **Entwickler-Sicht**. Die **Nutzer-Sicht** ist der
  Produkt-Changelog im Hilfezentrum (`scripts/seed-operator-content.mjs`,
  Array `CHANGELOG`) — dort steht nur, was Kunden merken.
- Einträge entstehen aus [Conventional Commits](docs/git-strategy.md);
  `pnpm changelog` zeigt den offenen Stand, `pnpm release` schreibt ihn fest.

> **Vor 0.1.0 wurde nicht versioniert.** Es gab keine Tags, `version` stand auf
> `0.0.0`. `0.1.0` fasst deshalb den zum Zeitpunkt der Umstellung ausgelieferten
> Stand zusammen, statt 33 Commits nachträglich zu rekonstruieren. Ein Tag
> `v0.1.0` existiert bewusst nicht: derselbe Commit trägt bereits `0.2.0` — der
> erste echte Release-Tag ist `v0.2.0`.

## [Unreleased]

_Noch keine Einträge._

## [0.2.3] – 2026-08-28

_Werkzeuge und Korrekturen aus dem ersten echten Migrationslauf — Erweiterungen bestehender Flächen, keine neue Fähigkeitsklasse._

### Hinzugefügt
- **mcp:** `update_video` — ein einzelnes Video ändern, ohne die Liste zu ersetzen (14b80ef)
- **mcp:** `prepare_video` — Transkript → KI-Titel und -Beschreibung; ohne Transkript wird nichts erfunden und nichts berechnet (14b80ef)
- **mcp:** `update_image_descriptions` — bis zu 40 Beschreibungen je Aufruf statt eines Roundtrips pro Bild (14b80ef)
- **mcp:** `import_article_from_url` kennt `on_conflict: "update"` und wird damit wiederholbar (14b80ef)
- **content:** Roadmap-Status „Angefragt" für Kundenwünsche ohne Zusage (14b80ef)

### Behoben
- **mcp:** `get_roadmap` lieferte `sort` nicht zurück — sortieren ging, nachlesen nicht (14b80ef)
- **mcp:** Der Import meldete „2 Bilder fehlgeschlagen" ohne Grund und verschwieg Überschriften, deren Inhalt beim Übernehmen verloren ging (14b80ef)
- **help-center:** Roadmap-Beschriftungen liefen über einen `as MessageKey`-Cast am i18n-Gate vorbei (14b80ef)

### Datenbank
- `0032_roadmap_requested.sql` — Status `requested` (Rebuild, forward-only). Die CI wendet Migrationen vor dem Deploy an.

## [0.2.2] – 2026-08-28

_Ein neuer Baustein auf dem bestehenden Blockmodell — keine neue Fähigkeitsklasse, daher defensiv patch._

### Hinzugefügt
- **content:** Verweis-Gitter (`articleLinks`) — bis zu zwölf Verweis-Karten nebeneinander, für Abschnitte wie „Weitere Features". Jede Karte wird einzeln indexiert; `get_content_conventions` nennt den Block, damit KI-Clients ihn benutzen (adb3d66)

### Behoben
- **content:** Kachel-Navigationen fremder Hilfeseiten gingen beim Übernehmen verloren — der Importer findet in einem Karten-Gitter keinen Text, es blieb eine leere Überschrift. Mit dem neuen Block lassen sich solche Abschnitte nachbauen (adb3d66)

## [0.2.1] – 2026-08-28

_Zwei Feinschliff-Features auf bestehenden Fähigkeiten (Medien im MCP-Server, Favicon-Slot im Branding) plus Fehlerbehebungen — keine neue Fähigkeitsklasse, daher defensiv patch._

### Hinzugefügt
- **branding:** eigenes Favicon je Instanz — quadratisches Emblem, zusätzlich ICO erlaubt; ohne eigenes Favicon dient das helle Logo als Tab-Icon (439c50e)
- **mcp:** `add_image_from_url` — Bild von einer öffentlichen Adresse nach R2, Beschreibung ist Pflichtfeld (25c7da9)
- **mcp:** `update_image_description` — Beschreibungen waren nach dem Hochladen bisher nirgends änderbar, auch nicht im Editor (25c7da9)

### Behoben
- **mcp:** `import_article_from_url` lud Bilder nicht herunter und legte keine Video-Einträge an; die Blöcke zeigten auf nicht existierende Ids und rendern als nichts — stiller Inhaltsverlust beim Übernehmen fremder Seiten (25c7da9)
- **admin:** Der Scope „Changelog und Roadmap pflegen" hatte keine Beschriftung in der Schlüssel-Verwaltung; ein `as MessageKey`-Cast hatte das i18n-Gate umgangen (25c7da9)

### Datenbank
- `0031_favicon.sql` — `tenants.favicon_r2_key` (additiv, forward-only). Die CI wendet Migrationen vor dem Deploy an.

## [0.2.0] – 2026-08-23

_Minor: MCP-Server mit Schreibzugriff, Changelog-/Roadmap-Pflege mit Versionsnummern,
vier neue Bausteine samt Inhaltsverzeichnis. Die Arbeit lag beim Release noch
uncommittet vor, deshalb ist dieser Abschnitt von Hand geschrieben statt aus
Commit-Nachrichten erzeugt._

### Hinzugefügt

- **content:** Vier neue Bausteine — aufklappbare Abschnitte (`<details>`, ohne
  JavaScript), Aktions-Buttons mit Ziel-Whitelist, Trennlinien und Datei-Anhänge
  (PDF, CSV, TXT, DOCX, XLSX, PPTX bis 10 MB) mit Byte-Prüfung und
  `attachment`-Auslieferung.
- **content:** Automatisches Inhaltsverzeichnis ab drei Überschriften, aus derselben
  Quelle wie die Abschnitts-Anker (rechts sticky, auf Mobil über dem Artikel).
- **updates:** Changelog und Roadmap sind pflegbar — neue Admin-Seite „Updates",
  API unter `/api/v1/admin/changelog` und `/roadmap`. Vorher gab es dafür nur das
  Seed-Skript.
- **updates:** Changelog-Einträge tragen optional eine freie Versionsnummer und eine
  Stufe; Leser sehen daraus „Großes Update" / „Neue Funktionen" / „Verbesserungen".
- **mcp:** Fünf Schreibwerkzeuge für Changelog und Roadmap unter dem neuen Scope
  `updates:write`; Löschen nur über das Zwei-Schritt-Bestätigungstoken.
- **widget:** Das Widget lässt sich zusätzlich im eigenen Hilfezentrum einblenden
  (Schalter in den Einstellungen) — eingebunden wird genau das Kunden-Snippet.
- **content:** URL-Import übernimmt jetzt auch Tabellen, Hinweisboxen,
  aufklappbare Abschnitte und Trennlinien; Bild-Limit von 12 auf 40 erhöht.
- **release:** Versionierung mit `CHANGELOG.md`, Git-Tags und Build-Auskunft über
  `/api/v1/health`; Werkzeuge `pnpm changelog`, `pnpm release`, `pnpm version:deployed`.
  Anzeige im Ops-Dashboard und im Admin-Bereich, CI-Gates vor und nach dem Deploy.

### Geändert

- **content:** Video-Karten neu gestaltet — weißes Play-Symbol im Glas-Kreis,
  Verlauf statt Flächen-Grau, Dauer-Badge.
- **content:** Überschriften sind einzeln teilbar (Link-Symbol kopiert die Adresse
  samt Sprungmarke).

### Behoben

- **content:** Beim Löschen eines Artikels blieben die Bilder für immer in R2
  liegen — jetzt werden Bilder und Dateien mit abgeräumt.
- **widget:** Der Loader fand seinen Origin nicht, wenn das Script dynamisch
  eingefügt wurde (Google Tag Manager, React-Hoisting) — das Widget erschien dort
  nie. Jetzt mit Fallback über das Script-Tag im DOM.
- **updates:** Das Changelog zeigte ein hartkodiertes Badge „Version 1.0.0";
  jetzt erscheint die Version des neuesten Eintrags, der eine trägt.
- **content:** Datei-Anhänge unter 1 KB wurden als „0 KB" angezeigt.

### Sicherheit

- **updates:** Der Scope `updates:write` ist von `articles:write` getrennt, weil
  Changelog-Einträge keinen Entwurfszustand haben und sofort öffentlich sind.
- **content:** Datei-Uploads werden aus den Bytes typisiert (kein HTML, SVG, JS
  oder EXE) und immer als `attachment` mit `nosniff` ausgeliefert.
## [0.1.0] – 2026-08-22

Erste versionierte Fassung — Zusammenfassung des ausgelieferten Stands.

### Hinzugefügt

- **Plattform:** Multi-Tenant-Hilfezentrum auf Cloudflare Workers (Next.js via
  OpenNext), Tenant-Auflösung pro Request aus dem Host, fail-closed bei
  unbekannten Hosts; White-Label-Branding über CSS-Variablen (Logo hell/dunkel,
  Farben, Instanzname im Header abschaltbar).
- **Inhalte:** Artikel als geordnete Blöcke — Text (Standard, Info, Warnung,
  Fehler, Code), Bilder mit Pflicht-Beschreibung, YouTube-Videos, Artikel-Link-
  Karten, Tabellen, aufklappbare Abschnitte, Buttons, Trennlinien und
  Datei-Anhänge; Artikel-Flags, Entwurf/Veröffentlichen/Zurückziehen,
  Versionierung je Änderung, Abschnitts-Anker mit Teilen-Link und automatisches
  Inhaltsverzeichnis.
- **Import/Export:** JSON-Export des Vollbestands, Import aus JSON und Markdown,
  Import per URL (inklusive Bildern, Videos, Tabellen und Hinweisboxen) sowie
  Bild-Vormerkungen für Inhalte ohne Binärdaten.
- **KI:** RAG über Vectorize und Workers AI mit Grounding-Schwelle, Quellen und
  Credit-Metering; gespeicherte Antworten mit Veraltet-Erkennung; KI-Übersetzung
  ganzer Artikel; Video-Aufbereitung aus eingefügten Transkripten.
- **Widget:** einbettbarer KI-Chat als ein Script-Tag, optional auch im eigenen
  Hilfezentrum; eigenständige Test-Seite zum Ausprobieren.
- **Konten & Team:** Better Auth mit strikter Instanz-Isolation, Rollen
  (Nutzer/Redaktion/Admin/Owner), Einladungen, 2FA-Pflicht für Team-Rollen,
  Eigentümer-Übertragung.
- **Betrieb:** Ops-Dashboard (Instanzen sperren/löschen, Enterprise-Rahmen,
  Selbstkostenrechner), Support-Tickets mit Inbox, Feedback- und
  Quellen-Statistik, SEO-Steuerung mit Sitemaps, Rechtstexte je Instanz.
- **CI/CD:** GitHub Actions mit Gates (Typecheck, Lint, i18n, Tests, Build),
  automatischen D1-Migrationen und getrennten Deploys für Staging und
  Produktion.

### Sicherheit

- Mandanten-Isolation als Invariante (kein Cross-Tenant-Zugriff auf Inhalte,
  Bilder, Dateien oder Sessions), MFA-Gates auf Team-Routen, SSRF-Schutz beim
  URL-Import, Byte-Prüfung und `attachment`-Auslieferung für Datei-Anhänge,
  Rate-Limits und Turnstile auf öffentlichen Endpunkten.
