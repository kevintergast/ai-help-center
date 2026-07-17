# HallofHelp Ops — internes Betreiber-Dashboard

Eigenständiger Worker (`hallofhelp-ops`) auf `ops.hallofhelp.com` (Staging:
`ops.dev.hallofhelp.com`). Liest dieselben D1-Datenbanken wie das Produkt;
Plan-/Preis-Logik kommt über den `@product/*`-Alias aus `../src` (keine
Duplikate). Zugriff **ausschließlich** über Cloudflare Access — zusätzlich
validiert der Worker jedes Access-JWT selbst (`src/access.ts`, fail-closed).

## Funktionen (v1)
- Plattform-Übersicht: Instanzen, MAU, Credits, Views/KI-Antworten/-Übersetzungen (30 Tage), offene Tickets, Tages-Charts
- Instanz-Tabelle: Owner, Plan, Status (aktiv/Limit+Kulanz/eingefroren), Credits/MAU, Overage-€, Artikel, Tickets
- Instanz-Detail: Stammdaten (Domain, SEO, Support-E-Mail), Abo & Nutzung, Nutzerliste (Rolle, Verifiziert, 2FA), offene Einladungen, letzte Tickets
- Aktionen: **Instanz erstellen** (inkl. Owner-Konto; Zugang via „Passwort vergessen") und **Nutzer einladen** mit Rolle (content/admin; Mail via Resend)
- **Widget-Demo verlinkt**: Header („Widget-Demo ↗") öffnet die Endkunden-Testseite
  (`widget-demo/`, workers.dev); auf jeder Instanz-Detailseite öffnet „Widget testen"
  die Demo direkt mit `?host=<slug>.hallofhelp.com` — ein Klick testet das Widget
  genau dieser Instanz cross-origin

## Verwaltung (v2): Blockieren, Enterprise-Rahmen, Löschen
Auf der Instanz-Detailseite, Sektion „Verwaltung":
- **Blockieren/Entsperren**: setzt `tenants.suspended_at`. Eine blockierte
  Instanz löst im Produkt **nicht mehr auf** (Subdomain UND Custom-Domain →
  „Instanz nicht gefunden", alle `/api/v1/*` → 404) — es entstehen keine
  KI-/Credit-Kosten mehr. Jederzeit reversibel.
- **Plan & Rahmen**: Plan direkt setzen (free/starter/scale/enterprise).
  Bei **Enterprise** zusätzlich individueller Deckel: `custom_included_credits`
  und `custom_mau_limit` (leer = Enterprise-Standard aus `pricing.ts`). Die
  Overrides wirken über die **geteilte Plan-Logik** überall — Produkt-
  Enforcement (over_limit → 30 Tage Kulanz → Freeze), Kunden-Admin und Ops
  zeigen dieselben effektiven Werte. Wechsel auf einen Self-Service-Plan
  **nullt** die Overrides automatisch.
- **Löschen (Gefahrenzone)**: nur zweistufig — Instanz muss **erst blockiert**
  sein, dann Löschung mit **exakter Slug-Eingabe** bestätigen. Räumt D1 (eine
  `DELETE`-Zeile, alles Weitere via `ON DELETE CASCADE`), Vectorize-Vektoren
  (IDs aus `search_chunks`) und R2 (`tenants/<id>/…`). Unumkehrbar; jede
  Löschung wird mit Ops-E-Mail im Worker-Log protokolliert.
- **Selbstschutz**: `t_operator` (unsere eigene Instanz) kann weder blockiert
  noch gelöscht werden.

## Selbstkostenrechner (`/kosten`)
Rechnet den Nutzungs-Mix eines individuellen Deals (KI-Antworten, Fragen ohne
Antwort, Übersetzungen, Views, MAU, Artikelbestand) in monatliche Selbstkosten
um — Kostentreiber einzeln (LLM, Embeddings, Vectorize, D1) plus Fixkosten,
in USD und EUR. Zusätzlich: verbrauchte **Credits** nach der Produkt-Preisregel
(`creditsFor`), daraus die **Empfehlung für den Enterprise-Rahmen**
(custom_included_credits/custom_mau_limit, +20 % Puffer) und bei eingegebenem
Deal-Preis die **Marge**. Alle Zahlen sind im Formular editierbar:
- **Preise** = Cloudflare-Listenpreise (Stand 2026-07, `src/costs.ts`) —
  bewusst konservativ ohne Abzug der Freikontingente.
- **Annahmen** (Tokens je Antwort/Übersetzung, D1-Zeilen je Vorgang) = 
  Schätzwerte — mit echten Zahlen aus den AI-Gateway-Logs kalibrieren.
Auf jeder Instanz-Detailseite verlinkt „→ Selbstkosten … kalkulieren" den
Rechner vorbefüllt mit den echten Zahlen der letzten 30 Tage.

## Einmaliges Setup (Kevin)

1. **Access-Application anlegen** — Zero-Trust-Dashboard (`one.dash.cloudflare.com`):
   - Access → Applications → **Add an application** → *Self-hosted*
   - Application name: `HallofHelp Ops`; Domain: `ops.hallofhelp.com` **und**
     (zweiter Eintrag/zweite App) `ops.dev.hallofhelp.com`
   - Policy: Action **Allow**, Include → **Emails** → deine E-Mail(s). Weitere
     Personen später = einfach E-Mail zur Policy hinzufügen.
   - Session Duration: z. B. 24h. Speichern.
2. **Werte übernehmen** (pro Application, unter *Overview*):
   - **Application Audience (AUD) Tag** kopieren → in `ops/wrangler.toml` bei
     `ACCESS_AUD` eintragen (Staging-App oben, Prod-App unter
     `[env.production.vars]`).
   - **Team-Domain** (Zero Trust → Settings → Custom Pages, Form
     `<team>.cloudflareaccess.com`) → `ACCESS_TEAM_DOMAIN` (beide Envs; gleiche
     Team-Domain).
3. **Resend-Key** (Einladungs-Mails):
   ```bash
   cd ops && npx wrangler secret put RESEND_API_KEY
   cd ops && npx wrangler secret put RESEND_API_KEY --env production
   ```
4. **Deploy**: läuft mit der normalen CI (Push auf `development` → Staging,
   `main` → Prod). Manuell: `pnpm -C ops deploy` / `pnpm -C ops deploy:prod`.

Bis Schritt 1+2 erledigt sind, antwortet der Worker deployt mit **503**
(fail-closed) — nichts ist offen.

## Lokale Entwicklung
```bash
pnpm -C ops dev   # http://localhost:8788 — gegen die LOKALE Produkt-D1
```
Das dev-Script setzt `OPS_DEV_BYPASS` (nur via CLI-Var, steht in keiner toml)
und teilt den Miniflare-State mit dem Produkt (`--persist-to ../.wrangler/state`).

## Qualität
- `pnpm -C ops typecheck` (strict, hono/jsx) — hängt am Root-`pnpm typecheck`
- Tests laufen im Root-Vitest mit (`ops/src/**/*.test.ts`): Access-JWT-Guard
  (Signatur/aud/iss/exp, fail-closed) + Queries gegen echte Migrations-DDL
- Root-ESLint ignoriert `ops/**` bewusst (React-Regeln passen nicht zu hono/jsx)
