# Infrastruktur-Fertigstellung — Plan vor „Dynamische Hilfeartikel mit KI"

**STATUS 2026-07-15 (abends): ALLE Schritte 1–6 gebaut** (Gates grün: 323 Tests;
Migrationen 0009+0010 lokal+Staging; Details: Memory implementation-status).
Schritt 5 komplett (TXT-Verify + Settings-UI + SaaS-Provisioner, inert ohne
Token); Schritt 6 queue-frei (AI-Gateway-Anbindung, Chunking+Hash, Vectorize-
Indexer mit Lifecycle-Hooks + owner-Reindex). Bewusste Abweichungen: Credit-
Counter = atomare D1-UPSERTs, Index-Sync = waitUntil statt Queue — beides
Ports, Queue/DO werden nachgerüstet, sobald Workers Paid bestätigt ist.
**Rest-Gate vor „Infrastruktur fertig" = nur noch User-Schritte:** lokaler
Secrets-Store-Seed, Workers Paid, SaaS-Token+Fallback-Origin (Custom-Domain-
SERVING), WAF-Rate-Limit auf /api/v1/events/view, demo/acme-Prod-Entscheidung,
Commit+Push (Staging-Deploy). Danach: RAG-Kern.

Stand: 2026-07-14. Ziel: Infrastruktur **fertig und sauber**, bevor der RAG-Kern
(dynamische KI-Artikel) gebaut wird. Das Metering-/Credit-System gehört laut
Produktentscheidung zur Infrastruktur (echte Preisberechnung, **noch keine echte
Abrechnung/Zahlungsmethoden** — Paddle folgt nach Firmengründung).

**Owner-Tags:** `[DU]` = Kevin · `[CLAUDE]` = Claude · `[🤝]` = beide

---

## Ist-Stand (verifiziert 2026-07-14, alle Gates grün: typecheck · lint · i18n · 269 Tests)

**Fertig & live:**
- Multi-Tenancy (fail-closed Host→Tenant), White-Label-Branding (SSR, R2-Logo), i18n DE/EN mit CI-Gate
- Komplette Auth (E-Mail/Passwort, Verify/Reset, MFA TOTP+OTP, Google-Social via Gateway, Invites, Ownership-Transfer, Rollen, Audit, strikte Instanz-Isolation), Legal-Docs-API
- Content-Backend (Lifecycle, Admin-CRUD), Hilfezentrum als Root `/` mit SEO-Artikel-URLs
- Operator-Console + Self-Service-Onboarding (Tenant-Provisionierung + Owner-Setup-Mail)
- CI/CD (GitHub Actions): `development`→Staging auto, `main`→Prod hinter Gate; Prod-Ressourcen komplett (D1/KV/R2/Vectorize, EU); Domain `hallofhelp.com` mit Wildcard-Routing (Prod `*.hallofhelp.com`, Dev `*.dev.hallofhelp.com`); Dogfood-Content live auf `app.hallofhelp.com`

**Fehlt (Soll-Abgleich):**
- **Nutzungs-Tracking/Metering** — Admin stats/kpi/inbox/plan laufen auf `fake-admin.ts` (Mock)
- **Credit-/Plan-System** (Ledger, Limits, over_limit→Freeze, Preisberechnung)
- **Turnstile** (Bot-Schutz Signup + Tenant-Erstellung — Voraussetzung fürs offene Self-Service)
- **Custom-Domain-Verify-Flow** (BYO-Domain aktuell fail-closed deaktiviert)
- **Queue + Durable Objects** (Workers Paid), **AI Gateway** — RAG-/Metering-Unterbau
- **RAG-Kern** selbst (bewusst NACH diesem Plan)
- Hygiene: tote `.gitlab-ci.yml`, Lint-Rest `legal/validate.ts:68`, demo/acme-Seeds in Prod-D1, Prod-`AUTH_SECRET` = Staging-Reuse, Microsoft-OAuth (bewusst vertagt)

**Entscheidungen 2026-07-14:**
1. Workers Paid **jetzt aktivieren** — mit Kosten-Leitplanken (unten).
2. Billing = **Metering + echte Preis-/Overage-Berechnung, keine Zahlungen** (Paddle-Checkout später, Layer provider-agnostisch).
3. Git: vorerst direkt auf `development`, gelegentlich Merge auf `main`; Claude arbeitet bei eigenen Änderungen nach der sauberen Strategie (Feature-Branch von `development`).
4. Scope „Infrastruktur fertig" = echtes Tracking (keine Mockdaten mehr) + Turnstile + Custom-Domain-Verify + Analytics-Wiring. Microsoft-OAuth ausdrücklich NICHT im Scope.

---

## Kosten-Leitplanken (Antwort auf „Angst vor plötzlich hohen Kosten")

Grundsatz: Cloudflare kennt **keinen harten Ausgaben-Deckel** — der Schutz ist
(a) fail-closed Enforcement in unserer App, (b) Alerts, (c) Rate-Limits.

1. **Free-Tier-Caps sind die eigentliche Kostenbremse:** Die Enforcement-Middleware
   (Schritt 3) prüft Credits **VOR** jedem teuren Aufruf (Workers AI). Ohne Credits
   keine Generierung → variable KI-Kosten sind pro Tenant hart gedeckelt.
2. **Cloudflare Billing-Notifications** `[DU]`: Dashboard → Notifications → Billing
   Alert bei z. B. 10 $ und 25 $/Monat einrichten (E-Mail).
3. **AI Gateway vor Workers AI** (Schritt 6): Caching (idente Fragen kosten nichts),
   Rate-Limits pro Gateway, Logging/Kosten-Sichtbarkeit pro Request.
4. **Turnstile + Rate-Limits** (Schritt 2): kein Bot kann Credits verbrennen.
5. **Größenordnung real:** Workers Paid 5 $/Monat fix. Queues/DO/Vectorize sind bei
   unserem Traffic Cent-Beträge (Abrechnung pro Mio. Operationen). Der einzige
   nennenswerte variable Posten ist Workers-AI-Inferenz — und die hängt hinter dem
   Credit-Gate. Erwartung Entwicklung/Start: **< 10 $/Monat gesamt**.

---

## Schritte (Reihenfolge = Abhängigkeiten)

### 1. Hygiene & Sicherheits-Reste (klein, sofort) `[🤝]`
- [CLAUDE] tote `.gitlab-ci.yml` entfernen; Lint-Rest `legal/validate.ts:68` fixen
- [CLAUDE] demo/acme-Seed-Tenants: Entscheidung umsetzen (aus Prod-D1 entfernen; `demo` ggf. bewusst als Show-Instanz behalten → dann dokumentieren)
- [DU] eigenen Prod-`AUTH_SECRET` im Secrets Store anlegen (neuer Eintrag) → [CLAUDE] in `wrangler.toml [env.production]` umhängen. Achtung: invalidiert bestehende Prod-Sessions/Tokens — jetzt trivial, später schmerzhaft
- [DU] Google-OAuth `redirect_uri` auf `https://auth.hallofhelp.com/api/v1/auth/callback/google` prüfen/setzen
- [DU] Bestätigen: echter Signup-Roundtrip inkl. Resend-Verify-Mail hat funktioniert (erstes Operator-Konto)

### 2. Turnstile — Bot-Schutz `[🤝]`
- [DU] Turnstile-Site im Dashboard anlegen (Widget „managed"), Site-Key + Secret-Key bereitstellen (Secret in Secrets Store/`.dev.vars`, nie Repo)
- [CLAUDE] Server-seitige Verifikation (siteverify) als Middleware an: Signup, Tenant-Erstellung (Console), Passwort-Reset-Request; Client-Widget in die Auth-/Console-UI; Tests (Fake-Verifier)

### 3. Metering-Fundament — echtes Nutzungs-Tracking + Credits (Kernstück) `[CLAUDE]`
> Ab hier gilt: **keine Mockdaten mehr** — jede Nutzung wird real erfasst.
- Migration `0009_usage_billing` (forward-only): `usage_events` (append-only; tenant_id, type, credits, actor_type anon/user/internal, anon_id, article_id, ts), `credit_ledger`, `tenant_plan` (plan, status active/over_limit/frozen, period_start, included_credits, mau_limit, grace_until)
- Credit-Kosten als Konfiguration (`src/server/billing/pricing.ts`): Artikel-View 1 · Suche 0 · KI-Generierung 20 (greift, sobald RAG existiert); Pläne Free/Starter/Scale inkl. Overage-Preisformel — **reine Berechnung/Anzeige, kein Zahlvorgang**
- Durable Object `CreditCounter` (Workers Paid, s. Schritt 6a) = atomarer Live-Stand pro Tenant; D1-Ledger = Wahrheit; Rebuild aus Ledger möglich
- Event-Erfassung serverseitig verdrahten: Artikel-View (public Artikel-Route), Suche; `actor_type=internal` für eingeloggte Team-Mitglieder (Filter lt. Architektur); MAU via `anon_id`-Dedup pro Monat
- Enforcement-Middleware (Hono): Status-Kette free→over_limit (30-Tage-Buffer, Banner/Countdown)→frozen (KI aus, Updates aus, Inhalte bleiben sichtbar); 402-Semantik; fail-closed
- Cron Triggers: Monatsreset, Grace-Auswertung, Freeze-Übergang (Limit-Mails via Resend)
- Provider-agnostisches Interface `BillingProvider` (Paddle-Implementierung später; jetzt `NoopProvider`)
- Tests: Credit-Berechnung/Kanten, Enforcement-Statuskette, Tenant-Scoping der Events, MAU-Dedup

### 4. Analytics-Wiring — Fake raus `[CLAUDE]`
- Admin **stats/kpi**: aus `usage_events` aggregieren (Views je Artikel, Trend, MAU, Credit-Verbrauch); Filter „interne Nutzer ausschließen"
- Admin **plan**: echte Daten aus `tenant_plan` + Counter (Balance, Reset-Datum, MAU-Auslastung, Overage-**Berechnung**, Grace-Countdown); Upgrade-Buttons als inaktiver Platzhalter bis Paddle
- Admin **inbox**: Support-Flow ist bewusst spätere Phase → ehrlicher Empty-State statt Fake-Tickets
- `src/lib/admin/fake-admin.ts` + `fake-repo`-Nutzungen entfernen (Definition-of-Done: kein Fake-Import mehr in `src/app`/`src/components`)
- Dogfood-Artikel zu Statistik/Plan aktualisieren (Regel: nur real Funktionierendes dokumentieren)

### 5. Custom-Domain-Verify-Flow `[🤝]`
- [CLAUDE] Verify-Flow für `tenant_domain`: TXT-Record-Challenge (`_hallofhelp-verify.<domain>`), Status pending→verified, Re-Check-Endpoint, Admin-UI in Settings; Resolver nutzt weiterhin NUR `status='verified'` (bestehendes fail-closed Verhalten)
- [CLAUDE] TLS/Routing via **Cloudflare for SaaS** (Custom Hostnames, 100 Stück frei) — Fallback-Origin einrichten, Custom-Hostname-API bei Verify anstoßen
- [DU] Cloudflare for SaaS in der Zone aktivieren (Dashboard, einmalig)

### 6. RAG-Unterbau (Infra, noch kein RAG-Feature) `[🤝]`
- a) [DU] **Workers Paid** aktivieren (5 $/Mo) + Billing-Alerts setzen (s. Leitplanken)
- b) [CLAUDE] Queues `hallofhelp-embeddings-staging`/`-prod` anlegen + Producer/Consumer-Binding in `wrangler.toml`; DO-Migration für `CreditCounter` (aus Schritt 3)
- c) [DU] **AI Gateway** `hallofhelp` im Dashboard anlegen → [CLAUDE] Workers-AI-Aufrufe durchs Gateway führen (Caching + Rate-Limit + Kosten-Sichtbarkeit), Modell-Konstanten zentral (`bge-m3` 1024/cosine — passt zum bestehenden Vectorize-Index; Generierung `llama-3.3-70b`, austauschbar gekapselt)
- d) [CLAUDE] Embedding-Pipeline für BESTEHENDE Artikel: Chunking + `content_hash` + Vectorize-Upsert über die Queue (publish/update/archive-Hooks) — damit ist beim RAG-Start der Index schon gefüllt und Staleness-Grundlage (Quell-Chunk-Hashes) vorhanden

### 🚦 Ready-Gate „Infrastruktur fertig"
- [ ] Keine Fake-Daten mehr im Admin (stats/kpi/plan echt, inbox Empty-State)
- [ ] Jede Nutzung erzeugt ein `usage_event`; Credits/MAU live sichtbar; Free-Limits greifen (over_limit→Freeze getestet)
- [ ] Turnstile aktiv auf Signup + Tenant-Erstellung
- [ ] Custom-Domain per TXT verifizierbar + via Cloudflare for SaaS erreichbar
- [ ] Queue + DO + AI Gateway live (Staging+Prod), Artikel-Index in Vectorize gefüllt
- [ ] Eigener Prod-AUTH_SECRET; Seeds in Prod geklärt; Billing-Alerts gesetzt
- [ ] Alle Gates grün + deployt (Staging→Prod)

**Danach:** „Dynamische Hilfeartikel mit KI" (RAG-Kern: Retrieval, Grounding-Schwelle,
No-Answer/Trust, dynamischer Artikel, Chat-Startview) — verbraucht dann von Tag 1
echte Credits über die fertige Metering-Pipeline.

---

## Bewusst NICHT in diesem Plan (Register bleibt gültig)
Paddle-Checkout/Webhooks (nach Firmengründung), Microsoft-OAuth, Support-Flow/Inbox,
Widget, Voice-Bot-API/Short-Link, Import/Export + Tiptap, Stream/Video, Legal/Ops-Track.
