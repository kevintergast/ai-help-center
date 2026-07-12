# Git- & CI/CD-Strategie

Für GitLab + Cloudflare Workers/D1. Zwei Umgebungen: **`develop` → Staging**, **`main` → Production**. Feature-getrieben, mit automatischen Tests pro Change und automatischem Deploy beim Merge.

> **⚠️ Umsetzung weicht von diesem Dokument ab — maßgeblich ist [`ci-cd-setup.md`](ci-cd-setup.md):**
> - Das Repo liegt auf **GitHub** → CI läuft über **GitHub Actions** ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)). Die untenstehende `.gitlab-ci.yml` ist nur noch **Referenz** (inert auf GitHub).
> - Der Dev/Staging-Branch heißt **`development`** (nicht `develop`).
> - Prod-Gate = **eine** Environment-Freigabe, die Migration → Deploy atomar abdeckt (statt zwei separater manueller Jobs). GitHub Actions kennt kein `when: manual`; das Gate kommt vom GitHub-Environment `production` mit Required-Reviewer.
> - Staging läuft bis zum Zone-Routing unter der `*.workers.dev`-URL (nicht `staging.hallofhelp.app`).
>
> Branching-Modell, Commit-Konventionen, Migrations-Disziplin und MR-Checkliste unten bleiben unverändert gültig.

## 1. Branching-Modell
- **`main`** = Production. Geschützt. Deploy nach Prod **nur mit manuellem Gate**.
- **`develop`** = Dev/Staging. Geschützt. Deploy nach Staging **automatisch** beim Merge.
- **Feature-Branches** zweigen von `develop` ab, mergen per MR zurück nach `develop`.
- **Hotfix** zweigt von `main` ab, mergt nach `main` (Prod) **und** wird nach `develop` zurückgemergt.
- **Release** (optional): `release/x.y.z` von `develop` → `main`.

```
feature/142-... ─┐
fix/187-...      ─┤  MR + Squash  →  develop ──auto──▶ Staging
chore/45-...     ─┘                    │
                                release/MR
                                       ▼
hotfix/233-... ──── MR ───────────▶  main  ──manuell──▶ Production
      └─────────── Back-Merge ────────▶ develop
```

| Branch-Typ | von | nach (MR) | Umgebung/Deploy |
|---|---|---|---|
| `feature/*`, `fix/*`, `chore/*`, `refactor/*`, `docs/*` | `develop` | `develop` | nur CI-Tests |
| `develop` | — | (Merge-Ziel) | **Staging (auto)** |
| `release/*` | `develop` | `main` | nur CI-Tests |
| `main` | — | (Merge-Ziel) | **Production (manuell bestätigt)** |
| `hotfix/*` | `main` | `main` **+ Back-Merge** `develop` | **Production (manuell)** |

## 2. Branch-Benennung
`<typ>/<issue-id>-<kurz-slug>` — kleingeschrieben, kebab-case.
Typen: `feature` · `fix` · `hotfix` · `chore` · `refactor` · `docs` · `release`.

Beispiele:
- `feature/142-credit-ledger`
- `fix/187-rag-citation-order`
- `hotfix/233-paddle-webhook-signature`
- `chore/45-bump-wrangler`

## 3. Commit-Nachrichten — Conventional Commits
Format: `type(scope): subject`
- **type**: `feat` · `fix` · `docs` · `refactor` · `perf` · `test` · `build` · `ci` · `chore` · `revert`
- **subject**: Imperativ, **≤ 72 Zeichen**, sachlich/konkret, kein Punkt am Ende
- **body** (optional): das *Warum*, auf 72 Zeichen umbrochen
- **footer**: `BREAKING CHANGE: …`, Issue-Referenz `Closes #142`
- **Sprache**: einheitlich — **Default Englisch** (Tooling/Ökosystem); Deutsch erlaubt, aber konsistent.

Beispiele:
```
feat(billing): add credit ledger with monthly reset

Tracks per-tenant credit debits in D1 and resets on the
billing-period boundary. Base for metered Paddle overage.

Closes #142
```
```
fix(rag): preserve citation order from retrieved chunks
```
DE-Variante (falls gewählt): `feat(billing): Credit-Ledger mit Monatsreset einführen`

> Empfehlung: `commitlint` + Husky-Hook erzwingt das Format lokal (in Phase 0 einrichten). MR-Titel folgt derselben Konvention — er wird beim Squash zur Commit-Nachricht.

## 4. Merge- & Schutz-Policy
- `main` und `develop` **protected**: kein Direct-Push, kein Force-Push.
- **MR Pflicht** mit: grüner Pipeline (Pflicht), **≥ 1 Approval**, aufgelöste Threads.
- **Squash-Merge** nach `develop` → saubere, lineare Historie (MR-Titel = Squash-Commit).
- `main` wird über Release-/Hotfix-MR aktualisiert und **getaggt** (`vX.Y.Z`, SemVer).
- „Source-Branch beim Merge löschen" aktivieren.

## 5. D1-Migrations-Disziplin
- **Forward-only**: ausgelieferte Migrationen werden **nie** editiert; Fehler werden per neuer Migration „fix-forward" behoben.
- **Eine logische Änderung pro Migration**, im MR reviewbar.
- **Expand/Contract**: erst additive Migration (kompatibel mit altem *und* neuem Code) → deployen → später Altes entfernen. Damit ist die Reihenfolge *migrate → deploy* immer sicher.
- Worker-Rollback bei Bedarf via `wrangler rollback` / versioniertem Deploy (DB bleibt forward).

## 6. Pipeline-Logik (siehe `.gitlab-ci.yml` unten)
- **MR-Pipeline**: `lint · typecheck · test · build` — **kein** Deploy.
- **Merge → `develop`**: Tests + `migrate:staging` → `deploy:staging` (automatisch).
- **Merge → `main`**: Tests + `migrate:production` → `deploy:production`, **beide mit manuellem Gate** (`when: manual`), Deploy hängt per `needs` an erfolgreicher Migration.
- **Keine Doppel-Pipelines**: `workflow:rules` lässt nur MR-Events und Pushes auf `develop`/`main` laufen — Feature-Branch-Pushes ohne MR erzeugen keine Pipeline.
- **Secrets**: `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` als **protected + masked** CI-Variablen → nur auf protected Branches (`main`/`develop`) verfügbar, also exakt dort, wo deployt wird. Nie im Repo, nie im Log.

## 7. `.gitlab-ci.yml`
```yaml
# AI Help Center — GitLab CI/CD für Cloudflare Workers/D1
default:
  image: node:22-slim
  cache:
    key:
      files: [pnpm-lock.yaml]
    paths: [.pnpm-store/]
  before_script:
    - corepack enable
    - pnpm config set store-dir .pnpm-store
    - pnpm install --frozen-lockfile

stages: [validate, test, build, migrate, deploy]

# Pipelines nur für MRs und für Pushes auf develop/main (keine Doppelläufe).
workflow:
  rules:
    - if: '$CI_PIPELINE_SOURCE == "merge_request_event"'
    - if: '$CI_COMMIT_BRANCH == "develop"'
    - if: '$CI_COMMIT_BRANCH == "main"'
    - when: never

lint:
  stage: validate
  script: [pnpm run lint]

typecheck:
  stage: validate
  script: [pnpm run typecheck]

unit-test:
  stage: test
  script: [pnpm run test -- --run]
  artifacts:
    when: always
    reports:
      junit: junit.xml

build:
  stage: build
  script: [pnpm run build]
  artifacts:
    paths: [dist/]
    expire_in: 1 day

# ---------- STAGING (auto bei Merge nach develop) ----------
migrate:staging:
  stage: migrate
  rules:
    - if: '$CI_COMMIT_BRANCH == "develop"'
  script:
    - pnpm exec wrangler d1 migrations apply hallofhelp-staging --env staging --remote

deploy:staging:
  stage: deploy
  needs: [build, migrate:staging]
  rules:
    - if: '$CI_COMMIT_BRANCH == "develop"'
  environment:
    name: staging
    url: https://staging.hallofhelp.app
  script:
    - pnpm exec wrangler deploy --env staging

# ---------- PRODUCTION (nur main, manuelles Gate) ----------
migrate:production:
  stage: migrate
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
      when: manual
  allow_failure: false
  script:
    - pnpm exec wrangler d1 migrations apply hallofhelp-prod --env production --remote

deploy:production:
  stage: deploy
  needs: [build, migrate:production]
  rules:
    - if: '$CI_COMMIT_BRANCH == "main"'
      when: manual
  allow_failure: false
  environment:
    name: production
    url: https://app.hallofhelp.app
  script:
    - pnpm exec wrangler deploy --env production
```
> Prod-Release = zwei bewusste Klicks: erst `migrate:production` abspielen, dann `deploy:production` (Deploy wartet per `needs` auf die erfolgreiche Migration).

## 8. MR-Template (Checkliste)
```
## Was & warum

## Checkliste
- [ ] Tests grün, neue Logik getestet
- [ ] D1-Migration forward-only & additiv (falls Schemaänderung)
- [ ] Doku/Changelog aktualisiert (falls nötig)
- [ ] Keine Secrets im Code/Log
- [ ] Branch- & Commit-Konvention eingehalten

Closes #
```
