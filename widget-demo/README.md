# HallofHelp Widget-Demo — fiktiver Endkunde

Eigenständiger Worker (`hallofhelp-widget-demo`) auf **workers.dev** — bewusst
eine fremde Domain/Zone, damit die Seite exakt die Situation eines echten
Kunden simuliert, der das Widget auf SEINER Website einbettet (Cross-Origin).
Die Seite besteht aus etwas Fülltext plus dem **offiziellen Einbett-Snippet**
aus den Instanz-Einstellungen:

```html
<script src="https://<host>/widget.js" async></script>
```

## Nutzung
- **Deployt**: `https://hallofhelp-widget-demo.<account>.workers.dev` — testet
  per Default die Instanz `app.hallofhelp.com` (Var `TENANT_HOST`).
- **Andere Instanz**: `/?host=demo.hallofhelp.com` (nur echte Hostnamen;
  alles andere wird verworfen → kein XSS über den Parameter, s. Tests).
- **Lokal**: `pnpm -C widget-demo dev` (http://localhost:8789) und daneben das
  Produkt (`pnpm dev`) — dann `/?host=app.localhost:3005`. Achtung: der
  localhost-Override funktioniert nur, wenn die Demo selbst über **http**
  läuft (eine https-Seite darf kein http-Script laden).

Fragen ans Widget erzeugen ECHTE Nutzung auf der Ziel-Instanz (Credits/MAU) —
zum Testen gedacht, nicht für Lasttests. Die Seite ist `noindex`.

## Qualität
- `pnpm -C widget-demo typecheck` — hängt am Root-`pnpm typecheck`
- Tests laufen im Root-Vitest mit (`widget-demo/src/**/*.test.ts`):
  Host-Validierung (XSS-Schutz) + Snippet-Vertrag
- Deploy: automatisch in der Staging-Pipeline (ein Worker, kein Env-Split)
