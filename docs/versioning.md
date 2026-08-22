# Versionierung & Releases

Ziel: Auf die Frage **„welche Version läuft gerade in Produktion?"** gibt es eine
Antwort, die man nachschlagen statt rekonstruieren muss — und zu jeder Version
eine Liste, was sich geändert hat.

## Die vier Bausteine

| Baustein | Wo | Rolle |
| --- | --- | --- |
| Versionsnummer | `package.json` → `version` | Quelle der Wahrheit |
| Release-Marke | Git-Tag `vX.Y.Z` | fixiert den Stand im Repo |
| Änderungsliste | `CHANGELOG.md` | was in welcher Version steckt |
| Laufende Version | `GET /api/v1/health` | was **tatsächlich** deployed ist |

Die letzte Zeile ist der Kern: Die laufende Version wird nicht aus CI-Logs
geraten, sondern beim Deployment erfragt. Version, Commit und Build-Zeit werden
zur **Build-Zeit** eingebacken (`next.config.ts` → `APP_VERSION`, `APP_COMMIT`,
`APP_BUILT_AT`), weil dasselbe Build-Artefakt nach Staging **und** Produktion
geht. Die Umgebung selbst (`APP_ENV`) kommt aus den wrangler-Vars.

## Wer entscheidet die Stufe (verbindlich)

**Claude entscheidet die Stufe — defensiv: lieber zu wenig als zu viel.**

| Stufe | Wofür | Wer |
| --- | --- | --- |
| **PATCH** | Bugfixes, kleine Anpassungen an bestehenden Features, Feinschliff, Wartung — der Normalfall | Claude |
| **MINOR** | substanziell neue Fähigkeiten (MCP-Server, ein ganzer Satz neuer Bausteine, neue Integration) | Claude |
| **MAJOR / 1.0** | riesige Updates, Erreichen von V1 | **gemeinsam** |

Warum defensiv: Eine zu hoch gezählte Version entwertet die Nummer als Signal —
eine zu niedrige ist harmlos. Und die eigentliche Frage („neue Fähigkeit oder
Feinschliff?") lässt sich nicht automatisieren.

Deshalb ist die Skript-Empfehlung absichtlich zurückhaltend: Vorschlag ist
**patch**, gefundene `feat`-Commits werden nur zur **Beurteilung aufgelistet**,
und **major schlägt das Skript nie vor**. Ein erkannter Breaking Change wird
defensiv zu einem Minor plus Hinweis, dass die Major-Frage offen ist.
`pnpm release major` verlangt zusätzlich `--confirm-major` — ein Versehen soll
nicht in einer 1.0.0 enden.

Die gewählte Stufe wird begründet, und die Begründung landet im Changelog:

```bash
pnpm release minor --reason "Minor: MCP-Server und vier neue Bausteine."
```

## Nummern-Schema (SemVer)

`MAJOR.MINOR.PATCH`, aktuell im `0.x`-Bereich:

- **PATCH** — Fehlerbehebungen, interne Aufräumarbeiten, Doku.
- **MINOR** — substanziell neue Fähigkeiten; im `0.x` **auch** Breaking Changes
  (Konvention für Vor-1.0-Software). Kleine Feature-Anpassungen sind PATCH.
- **MAJOR** — erst mit `1.0.0`: dann bedeutet ein Sprung einen Bruch an der
  öffentlichen API (`/api/v1`, MCP-Werkzeuge) oder am Datenmodell.

`1.0.0` ist bewusst noch nicht gesetzt: Solange Billing und die öffentliche API
nicht stehen, wäre die Zusage „stabile Schnittstellen" nicht ehrlich.

## Was wo hin gehört

Es gibt **zwei** Changelogs, und sie haben verschiedene Leser:

- `CHANGELOG.md` — **Entwickler-Sicht.** Vollständig, mit Commit-Kürzeln, auch
  Refactorings und Wartung. Entsteht aus den Commits.
- Produkt-Changelog im Hilfezentrum (`scripts/seed-operator-content.mjs`, Array
  `CHANGELOG`) — **Kunden-Sicht.** Nur was Nutzer merken, in ihrer Sprache, ohne
  Commit-Kram. Pflegbar im Verwaltungsbereich, über die API, per MCP oder im Seed.

Beides zu vermischen macht das eine unlesbar und das andere unvollständig.

### Pflicht: jedes Minor-Release erscheint im Produkt-Changelog

**Regel für unsere Instanz:** Zu jedem **Minor**-Release (und jedem Major) gibt
es einen Eintrag im Produkt-Changelog — mit genau dieser Versionsnummer und der
Stufe. Patches sind ausgenommen: ein Bugfix muss keine Mitteilung sein.

Das ist kein Vorsatz, sondern ein Gate: `pnpm release minor` bricht ab, wenn im
Seed kein Eintrag mit der neuen Version steht, und zeigt die fehlende Vorlage an.
Wurde der Eintrag direkt in der Instanz gepflegt (Verwaltungsbereich oder MCP),
erlaubt `--skip-product-changelog` die Ausnahme.

### Versionsnummern im Kunden-Changelog (Produkt-Feature)

Jeder Kunde kann den Changelog seines eigenen Produkts versionieren: pro Eintrag
eine **freie Versionsnummer** (kein SemVer-Zwang — „2.4.0", „R25-08",
„Frühjahr 2026") und optional eine **Stufe**, die Lesern als Badge erscheint:

| Stufe | Badge für Leser |
| --- | --- |
| `major` | Großes Update |
| `minor` | Neue Funktionen |
| `patch` | Verbesserungen |

Beides ist optional; ein Changelog ohne Versionen sieht aus wie vorher. Die
Kopfzeile der Changelog-Seite zeigt die Version des neuesten Eintrags, der eine
trägt (vorher stand dort eine hartkodierte „1.0.0" — eine Attrappe).

Gepflegt wird an vier Stellen, alle mit derselben Validierung:
Verwaltungsbereich → **Updates**, `PUT/POST /api/v1/admin/changelog`,
MCP-Werkzeug `create_changelog_entry` (Scope `updates:write`) und — für unsere
eigene Instanz — versioniert im Seed.

## Ablauf eines Releases

```bash
pnpm changelog          # was ist seit dem letzten Tag passiert? (schreibt nichts)
pnpm release patch --reason "Bugfixes am Editor."      # Normalfall
pnpm release minor --reason "MCP-Server als neue Fähigkeit."  # neue Fähigkeit
# ohne Stufe: defensiver Vorschlag (patch); major nur mit --confirm-major
```

`pnpm release` hebt `package.json`, schreibt den datierten Abschnitt in
`CHANGELOG.md` (der `Unreleased`-Inhalt wandert hinein, fehlende Einträge kommen
aus den Commits) und berührt git nicht. Danach normal arbeiten — erst
`development` → Staging prüfen, dann Merge nach `main` → Produktion (siehe
[git-strategy.md](git-strategy.md)).

**Den Tag setzt die CI.** Nach einem erfolgreichen Prod-Deploy legt der Job
`tag-release` `v<version aus package.json>` an und pusht ihn (idempotent: ist er
schon da, endet der Job still). Das hat zwei Vorteile: niemand muss Tags tippen,
und der Tag markiert genau den Stand, der wirklich live gegangen ist — nicht
einen Commit, von dem man hofft, dass er deployt wurde. Verhindert nebenbei den
klassischen Fehler „getaggt, aber der Deploy scheiterte".

## Nach dem Deploy prüfen

```bash
pnpm version:deployed
```

Zeigt lokalen Stand, Produktion und Staging nebeneinander — inklusive Warnung,
wenn eine Umgebung von der lokalen Version abweicht. Dieselbe Auskunft steht im
**Ops-Dashboard** unter „Ausgelieferte Versionen" (mit Hinweis, wenn Staging der
Produktion vorausläuft) und klein im **Admin-Bereich** unter der Navigation —
praktisch, wenn im Support die Frage aufkommt, welchen Stand jemand sieht.

## Gates in der CI

- **Vor dem Prod-Deploy:** `version` darf nicht `0.0.0` sein, und `CHANGELOG.md`
  muss einen Abschnitt für genau diese Version haben. Kein undokumentierter
  Stand in Produktion.
- **Nach dem Deploy:** `scripts/verify-deployed-version.mjs` fragt
  `/api/v1/health`, bis die erwartete Version antwortet (mehrere Versuche, weil
  Cloudflare kurz braucht). In Produktion bricht eine Abweichung den Job, in
  Staging wird sie nur berichtet — dort laufen bewusst auch Zwischenstände.

## Commit-Nachrichten

Die Changelog-Qualität hängt an den Commits ([Conventional
Commits](git-strategy.md)): `type(scope): Betreff`. Zuordnung:

| Commit | Abschnitt |
| --- | --- |
| `feat:` | Hinzugefügt |
| `fix:` | Behoben |
| `perf:`, `refactor:`, `revert:` | Geändert |
| Scope `security` | Sicherheit |
| `docs:`, `test:`, `chore:`, `ci:`, `build:`, `style:` | Wartung |
| `!` oder `BREAKING CHANGE:` im Body | Breaking Changes |
| alles ohne Präfix | Sonstiges |

Die letzte Zeile ist Absicht: Nicht-konforme Commits landen sichtbar unter
„Sonstiges", statt aus dem Changelog zu verschwinden. Ein Changelog, der Arbeit
unterschlägt, ist schlimmer als einer mit unsortierten Zeilen.
