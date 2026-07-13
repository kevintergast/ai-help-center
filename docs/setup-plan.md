# Setup-Plan — Vorbereitung vor Phase 0

Ziel: alle Konten, Domains, Infrastruktur und Zugänge **sauber & sicher** aufsetzen, damit die Entwicklung (Phase 0) ohne Blocker starten kann.

**Owner-Tags:** `[DU]` = du · `[CLAUDE]` = ich (sobald Zugang da) · `[DU+ANWALT]` = rechtlich
**Verwandte Listen:** [bootstrap-accounts-todo.md](bootstrap-accounts-todo.md) · [legal-todo.md](legal-todo.md)

---

## Reihenfolge auf einen Blick
**Stage 0** Identität (Domain + M365) → **Stage 1** Cloud-Konten & Infra (Staging) → **Stage 2** Claude/MCP-Zugänge → **Stage 3** Repo-Konventionen → **🚦 Ready-Gate** → **Phase 0**
*Parallel & unabhängig:* Firma & Recht (gated nur den Launch, nicht die Entwicklung).

---

## Stage 0 — Identität & Postfach `[DU]`
> Komplett als Privatperson machbar. Detail in [bootstrap-accounts-todo.md](bootstrap-accounts-todo.md).
- [ ] Cloudflare-Account (privat)
- [ ] Brand-Domain registrieren (Cloudflare Registrar; sonst extern + NS auf Cloudflare)
- [ ] Microsoft 365 einrichten + DNS (MX, SPF, DKIM, autodiscover, DMARC `p=none`)
- [ ] Rollen-Aliase: `founder@ · support@ · billing@ · dev@ · security@`
- [ ] Passwortmanager + 2FA überall

## Stage 1 — Cloud-Konten & Infrastruktur (Staging zuerst) `[DU]`
**GitLab**
- [ ] Projekt/Repo `ai-help-center` anlegen
- [ ] **Project-Access-Token** (nur dieses Projekt, `read_repository` + minimal `api`) für Claude — **keine** CI/CD-Variablen freigeben
- [ ] Branch-Protection auf `main`

**Cloudflare — Staging-Ressourcen provisionieren** (Namen als Vorschlag)
- [ ] D1: `hallofhelp-staging` (location hint EU)
- [ ] R2: `hallofhelp-assets-staging` + `hallofhelp-backups-staging` (Jurisdiction EU)
- [ ] Vectorize-Index: `hallofhelp-articles-staging` (**1024 Dim, Cosine** — passend zu `bge-m3`)
- [ ] KV: `hallofhelp-cache-staging`
- [ ] Queue: `embedding-queue-staging`
- [ ] Workers AI aktiv + **AI Gateway** `hallofhelp` anlegen
- [ ] **Turnstile**-Site (Keys) für Signup-Schutz
- [ ] **Cloudflare for SaaS**: Zone für die Subdomain-Basis (`*.hallofhelp.com`) vorbereiten
- [ ] **Stream** aktivieren (Video)
- [ ] **Secrets Store** einrichten — *alle* Secrets nur hier, nie im Repo/Chat

**Billing**
- [ ] Paddle **Sandbox**-Account (`billing@`) — Live erst nach Firmengründung

## Stage 2 — Claude / MCP-Zugänge (scoped · read-only · Staging) `[DU]`
> Sicherheitsgrenze: siehe Memory. Prod-Secrets/Live-Keys/Kundendaten bleiben bei dir.
- [ ] **Cloudflare Docs MCP** (🟢 OAuth, kein Token)
- [ ] **Cloudflare Bindings/Observability MCP** (🟡 nur **Staging**-Rolle/Token, Least-Privilege)
- [ ] **GitLab MCP** (🟡 Projekt-Token aus Stage 1)
- [ ] **Context7 MCP** (🟢 Docs)
- [ ] Kurz testen, dass jeder Connector antwortet → mir Bescheid geben

## Stage 3 — Repo- & Tooling-Konventionen `[CLAUDE]` (nach GitLab-Zugang)
- [ ] Monorepo-Struktur (App / Worker / Widget / Shared)
- [ ] `wrangler.toml` mit `[env.staging]`/`[env.production]` + alle Bindings
- [ ] TypeScript, ESLint, Prettier, Vitest
- [ ] CI-Pipeline-Skelett (Lint/Typecheck/Test/Build) + `wrangler d1 migrations`-Stage
- [ ] Secrets-Pattern (`.dev.vars` lokal, Secrets Store in CI) + `.gitignore`
- [ ] `CLAUDE.md` (Projektkonventionen) + `.env.example` (nur Variablen**namen**)

## 🚦 Ready-Gate (alles grün = Phase 0 startklar)
- [ ] Domain live, DNS grün, M365-Postfach sendet/empfängt
- [ ] Cloudflare Staging-Ressourcen existieren (D1, R2, Vectorize, KV, Queue, AI Gateway, Turnstile, Stream)
- [ ] GitLab-Projekt + scoped Token aktiv
- [ ] 4 MCP-Connectoren verbunden & getestet
- [ ] Paddle Sandbox bereit
- [ ] Secrets Store eingerichtet

---

## Parallel-Track: Firma & Recht `[DU+ANWALT]` (gated nur den Launch)
> Blockiert **nicht** die Entwicklung — kann/should parallel laufen. Detail in [legal-todo.md](legal-todo.md).
- [ ] Unternehmen gründen (UG/GmbH) → danach: Paddle-Live, USt-ID, Versicherung
- [ ] Pflicht-Rechtstexte entwerfen lassen (AGB/AVV/Datenschutz/Impressum/AUP)
- [ ] Trust-/Compliance-Artefakte (Roadmap) — vor größeren Deals

---

## Danach → Phase 0 (Scaffolding)
Repo-Grundgerüst, Worker+Hono, Vite+React, Wrangler-Envs verdrahtet, erste Migration, CI grün. Anschließend P1 (Tenancy/Auth) usw. gemäß Plan v2.
