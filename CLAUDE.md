# HallofHelp — Projektkonventionen

AI-First Hilfezentrum, **Multi-Tenant-SaaS** auf Cloudflare. Details/Entscheidungen siehe `docs/` und das Auto-Memory.

## Stack
- **Next.js** (App Router, TS) auf **Cloudflare Workers via OpenNext** (`@opennextjs/cloudflare`)
- **Tailwind** mit CSS-Variablen-Tokens (White-Label)
- **D1** (SQL), **R2** (Medien, Binding `MEDIA`), **Vectorize** (RAG), **Workers AI**, **KV** (`CACHE`)
- **Better Auth** (später), **Paddle** (Billing, später)
- Paketmanager: **pnpm**; Node 22

## Befehle
- `pnpm dev` — lokaler Next-Dev (mit CF-Bindings via OpenNext)
- `pnpm typecheck` · `pnpm lint` · `pnpm test`
- `pnpm preview` — OpenNext-Build lokal im Worker
- `pnpm deploy` — Build + `wrangler deploy` (i. d. R. über CI)
- `pnpm db:migrate:local` / `:staging`

## Struktur
- `src/app/` — Routen (App Router), `api/*` = Route Handlers
- `src/server/api/` — **öffentliche API** (`/api/v1`, Hono), eingehängt via `src/app/api/v1/[[...route]]`
- `src/server/` — Backend-/Domain-Schicht (transport-agnostisch), Basis für Content-Pflege & RAG-Anfragen
- `src/lib/tenant/` — Mandanten-Auflösung (Host → Tenant); heute Demo-Registry, später D1
- `src/lib/theme/` — Branding → CSS-Variablen
- `migrations/` — D1-Migrationen (forward-only)
- `docs/` — Pläne, Git-Strategie, Recherche, ToDos

## White-Label (Fundament)
Pro Request wird der Tenant aus dem **Host** aufgelöst (`getCurrentTenant()`), sein Branding als
**CSS-Variablen** aufs `<html>` gelegt (`--brand-primary/-accent/-primary-fg`). Tailwind-`brand`-Farben
lesen diese Variablen. Neue Tenants brauchen daher **keinen** Code — nur einen Datensatz (später D1).

**Isolation:** Der Tenant wird **pro Request aus dem Host** abgeleitet (`getCurrentTenant()`) — kein globaler/gemeinsamer Zustand. Jeder Tenant ist ein eigener Origin (Subdomain). Der Dev-Tenant-Switcher (`src/components/tenant-switcher.tsx`, nur `NODE_ENV!=production`) **navigiert** zwischen Hosts, statt zur Laufzeit umzuschalten → keine Vermischung, kein Cross-Tenant-Leak.

## Konventionen
- **Commits:** Conventional Commits (`type(scope): subject`, Imperativ, ≤72). Siehe `docs/git-strategy.md`.
- **Branches:** `feature/<issue>-<slug>` von `development`; `development`→Staging, `main`→Prod. Nie direkt pushen. CI = **GitHub Actions** (`.github/workflows/ci.yml`); Setup: `docs/ci-cd-setup.md`.
- **D1-Migrationen:** forward-only, additiv (expand/contract), eine logische Änderung pro Datei.
- **Sicherheit:** keine Secrets im Repo/Log. Werte via `wrangler login` (lokal) bzw. Secrets Store/CI.
  Claude bekommt nur scoped/read-only/Staging-Zugänge (siehe Memory `mcp-access-security-boundary`).

## Regeln (verbindlich)
### i18n
- **Jeder nutzersichtbare Text** (JSX-Text + übersetzbare Attribute: `alt`/`title`/`placeholder`/`aria-label`/`label`) MUSS über `t("key")` aus `src/i18n/messages/*` laufen — **keine hartkodierten Literale** in `.tsx`.
- `de` ist die Quelle (`MessageKey`); `en` ist `Record<MessageKey, string>` → **fehlende EN-Übersetzungen brechen den Typecheck**.
- Bewusst NICHT übersetzte Literale (Eigennamen, Dev-only-Labels, Code-Beispiele) → `src/i18n/allowed-phrases.json`.
- Prüfung: `pnpm i18n:check` (CI-Gate vor jedem Deploy).

### Test-/Deploy-Sicherheit
- Vor jedem Merge/Deploy müssen grün sein: `typecheck` · `lint` · `i18n:check` · `test` · `build` (siehe `.gitlab-ci.yml`, Stage `validate`/`test`/`build`).
- Neuer UI-String → DE **und** EN ergänzen. Neue Logik → passenden Test ergänzen.
- D1-Schemaänderung → neue forward-only-Migration (nie bestehende editieren).

### Tests — was & wie (bewusst schlank, Anti-Bloat)
- **Teste Verhalten/Verträge, nicht Implementierung.** Ein Test darf bei Refactorings **nicht** brechen — nur bei geändertem Verhalten.
- **Pflicht-Ziele:** (1) **Domänen-/Business-Logik mit Verzweigungen/Kanten** (Tenant-Auflösung, Credits/Limits/Overage, RAG-Grounding-Schwelle, RBAC, Staleness); (2) **API-Verträge** `/api/v1/*` (Status, Response-Shape, Mandanten-Scoping, Auth-Fehler) via `app.request()` **in-process**; (3) **Isolations-/Sicherheits-Invarianten** (kein Cross-Tenant-Leak, Guards greifen); (4) Mapping/Migrations-kritische Utilities.
- **Bewusst NICHT testen:** triviale Getter/Pass-throughs, Markup/Styling, Framework-/Drittanbieter-Verhalten (Next/Hono/Cloudflare/Paddle) — dafür dünne Adapter mit Fakes.
- **Wie:** Unit-Tests neben der Datei (`*.test.ts`); **Fakes statt echter Bindings** (Repository-/Source-Pattern → Fake einspeisen, keine Netz-/DB-Zugriffe). E2E nur für **wenige kritische Nutzerpfade**, später und sparsam.
- **Faustregel:** Jeder Test muss einen **benennbaren realen Fehlerfall** verhindern. Wenn nicht → kein Test. **Coverage ist kein Ziel — verhinderte Bugs sind es.**
- **Bei PRs:** neue Verzweigung/Regel → Test; Bugfix → Regressionstest, der **ohne** den Fix fehlschlägt.
- **Automatik:** läuft lokal vor jedem `git push` (Husky pre-push: `i18n:check` + `typecheck` + `test`) **und** in CI. **Merge nur bei grüner Pipeline** (GitLab-Setting „Pipelines must succeed").

## Grundsatz
Erst saubere Struktur/Plattform (Multi-Tenancy, White-Label), dann Features gemäß Plan v2 (`docs/`).
