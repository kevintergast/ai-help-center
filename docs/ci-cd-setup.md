# CI/CD-Setup — GitHub Actions → Cloudflare

Die Pipeline liegt in [`.github/workflows/ci.yml`](../.github/workflows/ci.yml) und setzt die
Strategie aus [`git-strategy.md`](git-strategy.md) um — angepasst an die **Realität**: Das Repo
liegt auf **GitHub**, also läuft CI über **GitHub Actions** (nicht die GitLab-`.gitlab-ci.yml`,
die nur noch als Referenz existiert).

## Ablauf

| Trigger | Was läuft |
|---|---|
| **Pull Request** (Ziel `development`/`main`) | `validate` (lint · typecheck · i18n) · `test` · `build` — **kein Deploy** |
| **Push/Merge → `development`** | Gates + `build` → **automatischer** Deploy nach **Staging** |
| **Push/Merge → `main`** | Gates + `build` → **Production**, aber **hinter manuellem Gate** (Environment-Reviewer) |

- **Ein Build, ein Artefakt:** `build` erzeugt den OpenNext-Worker einmal; Staging *und* Prod
  deployen exakt dieses Artefakt (kein „getestet ≠ deployt").
- **Reihenfolge:** immer erst D1-Migration, dann Deploy (sicher dank Expand/Contract-Disziplin).
- **Nebenläufigkeit:** überholte **PR**-Runs werden abgebrochen; **Deploy-Runs laufen immer zu
  Ende** (eine laufende Migration wird nie gekillt).

---

## Was du EINMALIG einrichten musst (kann Claude nicht)

### 1. Repo-Secrets (Settings → Secrets and variables → Actions → *Secrets*)

| Name | Wert |
|---|---|
| `CLOUDFLARE_ACCOUNT_ID` | `00447c721c71348f060c5a5d7bed87bc` |
| `CLOUDFLARE_API_TOKEN` | **scoped** Token (siehe unten) — **nicht** dein persönlicher Vollzugriffs-Token |

> **Sicherheit:** Aktuell ist die Wrangler-CLI mit einem persönlichen Token (`kevin.kvano@gmail.com`,
> breiter Schreibzugriff) angemeldet. Für CI **einen eigenen, scoped Token** erstellen — passend zur
> Boundary „Claude nur scoped/read-only/Staging". Der CI-Token gehört in GitHub, nie ins Repo/Log.

### 2. API-Token-Scopes (My Profile → API Tokens → *Create Custom Token*)

Der Worker bindet D1, KV, R2, Vectorize, Workers AI **und** ein Secrets-Store-Secret. Ein Token nur
mit „Workers Scripts: Edit" **scheitert** (am ehesten übersehen: Secrets Store + D1). Mindestens:

- **Account** → Workers Scripts: **Edit**
- **Account** → D1: **Edit**  *(für `wrangler d1 migrations apply` + Binding)*
- **Account** → Workers KV Storage: **Edit**
- **Account** → Workers R2 Storage: **Edit**
- **Account** → Vectorize: **Edit**
- **Account** → Workers AI: **Read**
- **Account** → Secrets Store: **Edit**  *(um das `AUTH_SECRET`-Binding zu attachen)*
- **Account** → Account Settings: **Read**
- **User** → Memberships: **Read**  *(Wrangler-Identität)*

→ **Account Resources** auf genau *dieses eine* Account beschränken.

### 3. GitHub-Environment `production` = das Prod-Gate (Settings → Environments)

Der Workflow feuert `deploy-production` bei *jedem* Merge nach `main`. Das **Anhalten zur Freigabe**
kommt allein vom Environment — also zwingend konfigurieren:

- **Environment `production` anlegen**
- **Required reviewers**: mindestens 1 (du) → jeder Prod-Deploy wartet auf einen Klick
- **Deployment branches**: auf `main` beschränken
- **Environment *variable*** `PROD_GATE_CONFIGURED = true` setzen
  *(Defense-in-Depth: der Preflight im Job bricht laut ab, falls diese Variable fehlt — so kann ein
  versehentlich ungeschützt angelegtes Environment nicht still nach Prod deployen.)*

Das `staging`-Environment braucht **keine** Schutzregel (Auto-Deploy ist gewollt); es wird beim
ersten Lauf automatisch angelegt.

---

## Bevor `main → Production` das erste Mal genutzt wird

Prod ist im Code verdrahtet, aber **noch nicht lauffähig** — der Preflight blockiert absichtlich,
solange Platzhalter in `wrangler.toml` stehen. Vorher erledigen:

1. **Prod-D1 anlegen** und ID eintragen:
   ```bash
   wrangler d1 create hallofhelp-prod
   # → database_id nach wrangler.toml [[env.production.d1_databases]] (ersetzt <FILL später>)
   ```
2. **Prod-KV anlegen** und ID eintragen:
   ```bash
   wrangler kv namespace create hallofhelp-cache-prod
   # → id nach wrangler.toml [[env.production.kv_namespaces]] (ersetzt <FILL später>)
   ```
3. R2 (`hallofhelp-assets-prod`) und Vectorize (`hallofhelp-articles-prod`) **existieren bereits**.
4. *(optional, Härtung)* eigenes Prod-`AUTH_SECRET` im Secrets Store statt Reuse des Staging-Werts.
5. `wrangler.toml` committen — der Preflight (`grep FILL`) lässt Prod erst danach zu.

---

## Nächstes Gate: Zone-Routing (aktuell bewusst offen)

Ohne Custom-Domain ist der Worker nur unter `*.workers.dev` erreichbar — dort scheitert die
Tenant-Auflösung fail-closed (nur `/health` funktioniert). Für einen **nutzbaren** Stand:

- Domain als **Cloudflare-Zone** hinterlegen. `BASE_DOMAINS` kennt aktuell nur `hallofhelp.com`
  (plus `localhost` fürs lokale Dev); die früher angedachte zweite `.app`-TLD wurde **nie
  registriert** — genutzt wird ausschließlich `hallofhelp.com`. Prod läuft damit unter
  `hallofhelp.com` (Operator `app.hallofhelp.com`, Tenants `<slug>.hallofhelp.com`).
- Routen in `wrangler.toml` je Env ergänzen (`routes = [{ pattern = "...", custom_domain = true }]`)
  und die `environment.url` in `ci.yml` von der workers.dev-URL auf die echte Domain umstellen.
- **Achtung:** `staging.hallofhelp.com` würde vom Tenant-Parser als Slug `staging` gelesen — Staging
  braucht daher eine **eigene Basis-Domain** (separate Zone) und bleibt bis dahin auf der
  `*.workers.dev`-URL, statt einer `staging.`-Subdomain unter der Prod-Domain.

---

## Aktivierung

1. Secrets (1) + Environment (3) einrichten.
2. `.github/workflows/ci.yml` (+ die übrigen Änderungen) nach `development` bringen (per MR).
3. Merge nach `development` → erster automatischer Staging-Deploy läuft.
4. `main → Production` erst freischalten, wenn Prod-Ressourcen (oben) provisioniert sind.

## Optionale Härtung
- Actions in den Deploy-Jobs auf **Commit-SHAs pinnen** (statt `@v4`) — sie laufen neben dem
  Cloudflare-Token; Dependabot/Renovate hält sie aktuell.
- „Allowed actions" im Repo auf verifizierte/first-party Actions beschränken.
