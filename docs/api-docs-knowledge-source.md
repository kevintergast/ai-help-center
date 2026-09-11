# API-Dokumentation als Wissensquelle — Plan

Stand: 2026-09-11. Ziel: Die KI-Antworten sollen **Fragen zur API des Kunden**
beantworten können, ohne dass wir dessen API-Referenz bei uns rendern.

**Owner-Tags:** `[DU]` = Kevin · `[CLAUDE]` = Claude · `[🤝]` = beide

---

## 1. Das Problem, konkret

Seit 0.2.4 kann ein Kunde seine API-Doku oben in der Navigation verlinken
(Migration 0033, `apiDocsUrl`). Für Menschen ist das die richtige Lösung. Für
die KI ist es **nichts**: `blockTexts` nimmt von einem Button nur Beschriftung
und Adresse auf, Datei-Anhänge (`file`) tauchen dort **gar nicht** auf. Ein
verlinktes Ziel ist für das Grounding unsichtbar.

Die Folge ist die schlechteste Antwort, die unser Produkt geben kann — und sie
ist reproduzierbar. Auf `app.hallofhelp.com` nach „MCP" gefragt (2026-08-28):

> „Dazu habe ich in den Hilfeartikeln keine belastbare Antwort gefunden."

Das ist korrektes Verhalten der Grounding-Schwelle bei fehlendem Wissen — aber
bei einem Produkt, dessen Kern „KI antwortet aus deinen Inhalten" ist, ist
genau das die Stelle, an der ein Entwickler abspringt.

## 2. Was wir NICHT bauen (Entscheidung)

**Kein Rendering fremder API-Referenzen.** Begründung:

- Eine Referenz wird aus einem Spec **generiert** und ändert sich mit jedem
  Release des Kunden. Eine Kopie bei uns ist nach seinem nächsten Deploy
  falsch — und widerspricht unserer eigenen Dogfooding-Regel („nur was real
  funktioniert").
- Der Markt ist besetzt und ausgereift (Redoc, Stoplight, Scalar, Mintlify).
  Rendering zu bauen kostet Monate und differenziert nicht.
- Es ist neben der Strategie: Unser Asset ist **Grounding**, nicht Darstellung.

Der Mensch geht also weiterhin über den Header-Link nach draußen. Was wir
holen, ist ausschließlich **Futter für die Antworten**.

## 3. Warum OpenAPI und nicht HTML-Crawling

Verifiziert am echten Fall (smao, 2026-09-11): Die Doku unter
`docs.smao.ai/docs/public` nennt selbst einen Live-Spec unter
`https://api.smao.ai/api/v1/openapi.json` — **OpenAPI 3.1.0, 143 KB,
28 Pfade, 60 Operationen, 80 Schemas, `info.version: 1.6.0`**, öffentlich
erreichbar, mit sauberen `summary`-Feldern.

Das ist die deutlich bessere Eingabe:

| | OpenAPI-Spec | HTML-Crawling |
|---|---|---|
| Struktur | eine Operation = ein Dokument | eine Seite = ein Dokument |
| Chunk-Größe | passend fürs Grounding | 60 Endpunkte auf einer Seite → Score unter der Schwelle |
| Stabilität | maschinenlesbar | bricht bei jedem Redesign |
| Staleness-Signal | `info.version` / ETag | nur Inhalts-Hash |

Die Chunk-Größe ist der entscheidende Punkt. `aux-docs.ts` dokumentiert für
Roadmap-Einträge schon gemessen: *„ohne Verstärkung landen ihre
Embedding-Scores systematisch unter der Grounding-Schwelle (real gemessen:
0.542)"*. Eine 143-KB-Seite als ein Dokument hat das umgekehrte Problem — die
Frage „wie löse ich per API einen Anruf aus?" trifft dann nichts Spezifisches.
Ein Dokument je Operation trifft genau `POST /calls`.

**HTML-Crawling** bleibt ein spätere Fallback für Kunden ohne Spec, nicht
Schritt 1.

## 4. Architektur-Entscheidungen

**E1 — Pseudo-Dokumente über das bestehende `AuxDoc`-Muster.**
`search/aux-docs.ts` indexiert Roadmap und Changelog bereits als
Pseudo-Dokumente mit präfixierten Ids (`rm:`, `cl:`), und der Kommentar dort
benennt die tragende Regel: *dieselben Builder speisen Indexierung UND
Antwort-Kontext, damit die `content_hashes` beider Seiten exakt
übereinstimmen*. Eine API-Operation wird das dritte `kind` mit Präfix `api:`
— gleicher Pfad, gleicher Hash, gleiche Grounding-Schwelle, kein neuer
Index-Mechanismus.

**E2 — Ein Dokument je Operation, nicht je Pfad.**
`GET /contacts` und `POST /contacts` sind verschiedene Fragen. Id:
`api:<sourceId>:<method>:<path>`.

**E3 — Zitate zeigen nach AUSSEN.**
`types.ts` hält heute fest: *„Artikel-Slug (nur kind article) — fürs
Verlinken"*. Ein zitierter API-Abschnitt hat keinen Slug bei uns. `SourceRef`
braucht daher ein optionales `externalUrl`. **Bewusst einfach:** Wir zeigen auf
die registrierte Doku-URL (dieselbe wie im Header), nicht auf einen geratenen
Anker — Anker-Schemata unterscheiden sich je Doku-Generator, und ein
404-Deeplink ist schlechter als ein Treffer auf der Übersichtsseite.

**E4 — Registrierte Quelle, nicht Einmal-Import.**
`import_article_from_url` erzeugt Artikel und verrottet danach genauso wie eine
Handkopie. Eine Quelle ist ein **Datensatz mit Neuabruf**, kein Import-Lauf.

**E5 — Datei ODER URL.**
Nicht jede Kunden-Doku ist öffentlich. Der Spec muss auch hochladbar sein
(`application/json`/`yaml`, Deckel wie bei Bildern). Bei smao ist er öffentlich
— das ist Glück, nicht die Regel.

**E6 — SSRF und Deckel wie beim Bild-Import.**
`assertImportableUrl` vor jedem Abruf (kein localhost, keine IP-Literale, nur
http/https auf Standard-Ports), harter Größendeckel, Typ aus den Bytes. Die
Funktion existiert und ist erprobt.

**E7 — Embedding-Kosten sind gedeckelt, weil der Hash-Vergleich schon da ist.**
Der Indexer zahlt laut Operator-Artikel nur für geänderte Chunks
(*„unveränderte kosten dank Hash-Vergleich nichts"*). Ein Neuabruf von 60
Operationen, von denen zwei sich geändert haben, kostet zwei Embeddings.
Zusätzlich: `info.version` + ETag vorher prüfen und bei Gleichstand gar nicht
parsen.

**E8 — Keine Credits für den Sync.**
Wie beim MCP-Schreiben (`docs/mcp-plan.md` E6): Es entstehen Embedding-Kosten,
aber keine Inferenz. Als `usage_event` mit `credits=0` zählen, damit Nutzung
sichtbar ist. **Offen `[DU]`:** ob ein Deckel je Plan nötig ist (ein Kunde mit
2.000 Operationen ist ein anderer Fall als 60).

## 5. Datenmodell

Neue Tabelle, forward-only:

```sql
-- 00XX_api_doc_sources.sql
CREATE TABLE api_doc_source (
  tenant_id    TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  id           TEXT NOT NULL,
  kind         TEXT NOT NULL DEFAULT 'openapi' CHECK (kind IN ('openapi')),
  spec_url     TEXT,              -- NULL bei hochgeladenem Spec
  spec_r2_key  TEXT,              -- NULL bei URL-Quelle
  docs_url     TEXT,              -- Ziel der Zitate (default: tenants.api_docs_url)
  spec_version TEXT,              -- info.version beim letzten Sync
  etag         TEXT,              -- HTTP-ETag, spart den Parse
  last_sync_at INTEGER,
  last_error   TEXT,              -- letzter Fehler im Klartext, für die UI
  operations   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, id)
);
```

Genau eine Quelle je Instanz in v1 (`id = 'default'`). Mehrere Quellen sind
additiv nachrüstbar; jetzt wären sie unnötige UI-Komplexität.

## 6. Schritte

### Schritt 1 — Spec → Dokumente (pure Funktion) `[CLAUDE]`
`src/server/apidocs/openapi.ts`: Spec-JSON → `AuxDoc[]`. Je Operation:
Methode, Pfad, `summary`, `description`, Parameter mit Typ und
Pflicht-Kennung, Request-/Response-Schema **aufgelöst** (`$ref` folgen,
Zyklen abbrechen), Fehlercodes, `security`. Titel in der Form
`API: POST /calls — Trigger an outbound call`.

Ohne Netz testbar, gegen den echten smao-Spec als Fixture.
**DoD:** 60 Dokumente aus 143 KB; ein Test hält fest, dass `POST /calls` und
`GET /calls` getrennte Dokumente mit unterschiedlichen Hashes sind.

### Schritt 2 — Quelle registrieren + Sync `[CLAUDE]`
Migration, Store, `PUT /admin/settings/api-docs-source` (admin), Abruf mit
SSRF-Guard und ETag-Kurzschluss, Anbindung an den Indexer über `AuxDoc`.
**DoD:** Nach dem Sync antwortet `/ask` auf „wie löse ich per API einen
ausgehenden Anruf aus?" mit `POST /calls` als Quelle.

### Schritt 3 — Zitate nach außen `[CLAUDE]`
`SourceKind` um `api` erweitern, `SourceRef.externalUrl`, Rendering der
Quellen-Karte mit Außen-Symbol (`ExternalLinkIcon` existiert).
**DoD:** Ein zitierter Endpunkt öffnet die Kundendoku im neuen Tab.

### Schritt 4 — Geplanter Neuabruf `[CLAUDE]`
Cron (täglich), ETag/`info.version` zuerst, sonst Diff über Hashes. Fehler
landen in `last_error` und sind in den Einstellungen sichtbar — eine stumm
veraltete Quelle ist schlimmer als keine.
**DoD:** Zweiter Lauf ohne Spec-Änderung erzeugt **null** Embedding-Aufrufe.

### Schritt 5 — MCP + Dogfooding `[🤝]`
`update_api_doc_source` unter `settings:write` (dieser Scope hat bis heute
**kein einziges Werkzeug** — hier ist der natürliche Anlass). Operator-Artikel
„API-Dokumentation verlinken" um den Wissensquellen-Teil erweitern; der sagt
derzeit korrekt, dass ein verlinktes Ziel für die KI unsichtbar ist, und muss
mit diesem Feature umgeschrieben werden.

### Später, bewusst vertagt
- HTML-Crawling für Kunden ohne Spec.
- Mehrere Quellen je Instanz.
- Anker-Deeplinks je Doku-Generator.

## 7. Tests (je Test ein benennbarer Fehlerfall)

- `$ref`-Zyklus im Spec → Parser terminiert, statt den Worker zu hängen
- 60 Operationen → 60 Dokumente, `POST`/`GET` auf gleichem Pfad getrennt
- Spec unverändert → Sync macht **null** Embeddings *(Kostenschutz)*
- Spec-URL auf `localhost`/IP-Literal → abgelehnt, ohne Abruf *(SSRF)*
- Nicht-JSON/kaputtes YAML → `last_error` gesetzt, alte Dokumente **bleiben**
  *(ein Fehlabruf darf den Index nicht leeren)*
- Quelle gelöscht → alle `api:`-Dokumente verschwinden aus dem Index
  *(kein Wissen über eine Doku, die der Kunde entfernt hat)*
- Zitiertes API-Dokument → `externalUrl` gesetzt, kein interner Slug

## 8. Offene Entscheidungen `[DU]`

1. **Deckel je Plan** für die Zahl der Operationen (E8)?
2. **Sichtbarkeit:** Sollen die API-Dokumente auch in der Artikel-**Suche**
   auftauchen, oder ausschließlich als Antwort-Quelle? Nur-Quelle ist
   kleiner und konsistent mit „wir rendern nicht".
3. **Mehrsprachigkeit:** Specs sind fast immer englisch, Antworten oft
   deutsch. Übersetzen wir die Beschreibungen beim Sync (Kosten) oder
   verlassen wir uns darauf, dass das Modell zweisprachig antwortet?
