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
- `src/lib/tenant/` — Mandanten-Auflösung (Host → Tenant); heute Demo-Registry, später D1
- `src/lib/theme/` — Branding → CSS-Variablen
- `migrations/` — D1-Migrationen (forward-only)
- `docs/` — Pläne, Git-Strategie, Recherche, ToDos

## White-Label (Fundament)
Pro Request wird der Tenant aus dem **Host** aufgelöst (`getCurrentTenant()`), sein Branding als
**CSS-Variablen** aufs `<html>` gelegt (`--brand-primary/-accent/-primary-fg`). Tailwind-`brand`-Farben
lesen diese Variablen. Neue Tenants brauchen daher **keinen** Code — nur einen Datensatz (später D1).

## Konventionen
- **Commits:** Conventional Commits (`type(scope): subject`, Imperativ, ≤72). Siehe `docs/git-strategy.md`.
- **Branches:** `feature/<issue>-<slug>` von `develop`; `develop`→Staging, `main`→Prod. Nie direkt pushen.
- **D1-Migrationen:** forward-only, additiv (expand/contract), eine logische Änderung pro Datei.
- **Sicherheit:** keine Secrets im Repo/Log. Werte via `wrangler login` (lokal) bzw. Secrets Store/CI.
  Claude bekommt nur scoped/read-only/Staging-Zugänge (siehe Memory `mcp-access-security-boundary`).

## Grundsatz
Erst saubere Struktur/Plattform (Multi-Tenancy, White-Label), dann Features gemäß Plan v2 (`docs/`).
