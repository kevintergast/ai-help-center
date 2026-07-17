/**
 * WIDGET-DEMO — simuliert einen ENDKUNDEN, der das HallofHelp-Widget auf
 * seiner eigenen Website einbettet. Läuft als eigener Worker auf workers.dev
 * (echter Fremd-Origin, andere Zone als hallofhelp.com) und enthält exakt das
 * offizielle Einbett-Snippet aus den Instanz-Einstellungen:
 *
 *   <script src="https://<host>/widget.js" async></script>
 *
 * Welche Instanz getestet wird, bestimmt TENANT_HOST (wrangler.toml) — per
 * `?host=demo.hallofhelp.com` übersteuerbar (z. B. Staging oder lokal).
 */

export interface Env {
  TENANT_HOST?: string;
}

/**
 * Strenge Host-Validierung für den `?host=`-Override — verhindert, dass über
 * den Query-Parameter Markup/Schema in die Seite injiziert wird (reflected
 * XSS bzw. ein Script-Tag auf fremde Origins). Erlaubt sind ausschließlich:
 *  - öffentliche Hostnamen (a-z, 0-9, Bindestrich, Punkte) → https
 *  - *.localhost / localhost mit optionalem Port (lokale Produkt-Dev) → http
 * Das erlaubte Zeichen-Set enthält keine HTML-/URL-Sonderzeichen — der Wert
 * ist damit gefahrlos interpolierbar.
 */
export function parseTenantHost(raw: string | null): { host: string; origin: string } | null {
  if (!raw) return null;
  const host = raw.trim().toLowerCase();
  if (host.length === 0 || host.length > 253) return null;

  const label = "[a-z0-9]([a-z0-9-]*[a-z0-9])?";
  if (new RegExp(`^(${label}\\.)*localhost(:\\d{1,5})?$`).test(host)) {
    return { host, origin: `http://${host}` };
  }
  if (new RegExp(`^${label}(\\.${label})+$`).test(host)) {
    return { host, origin: `https://${host}` };
  }
  return null;
}

function page(host: string, origin: string, overridden: boolean): string {
  const snippet = `<script src="${origin}/widget.js" async></script>`;
  const snippetShown = snippet.replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<!doctype html>
<html lang="de">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>Beispiel GmbH — Widget-Testseite</title>
<style>
:root{--bg:#f7f6f3;--surface:#fff;--ink:#20201d;--muted:#6d6b66;--line:#e4e1da;--accent:#0d7a5f}
@media (prefers-color-scheme:dark){:root{--bg:#171613;--surface:#211f1c;--ink:#f0efec;--muted:#a5a29b;--line:#39362f;--accent:#3ecf9f}}
*{box-sizing:border-box;margin:0}
body{font:16px/1.6 -apple-system,system-ui,sans-serif;background:var(--bg);color:var(--ink)}
header{background:var(--surface);border-bottom:1px solid var(--line);padding:18px 24px;display:flex;gap:14px;align-items:baseline}
header b{font-size:18px}
header span{color:var(--muted);font-size:13px}
main{max-width:820px;margin:0 auto;padding:32px 24px 120px}
h1{font-size:30px;line-height:1.25;margin:18px 0 10px}
h2{font-size:19px;margin:34px 0 8px}
p{margin:10px 0;color:var(--ink)}
.lead{color:var(--muted);font-size:17px}
.card{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:16px 18px;margin:22px 0}
.card small{color:var(--muted)}
code,pre{font-family:ui-monospace,monospace;font-size:13px}
pre{background:var(--surface);border:1px solid var(--line);border-radius:10px;padding:12px 14px;overflow-x:auto}
.pill{display:inline-block;border:1px solid var(--line);background:var(--surface);border-radius:999px;padding:3px 12px;font-size:12.5px;color:var(--muted)}
.pill b{color:var(--accent)}
form.host{display:flex;gap:8px;margin-top:10px;flex-wrap:wrap}
input{flex:1;min-width:220px;padding:8px 12px;border:1px solid var(--line);border-radius:8px;background:var(--bg);color:var(--ink);font-size:14px}
button{padding:8px 16px;border:0;border-radius:8px;background:var(--accent);color:#fff;font-weight:600;cursor:pointer}
a{color:var(--accent)}
footer{color:var(--muted);font-size:12.5px;margin-top:48px;border-top:1px solid var(--line);padding-top:14px}
</style>
</head>
<body>
<header><b>Beispiel GmbH</b><span>Fiktiver Endkunde · nur zum Widget-Testen</span></header>
<main>
  <span class="pill">Widget-Quelle: <b>${host}</b>${overridden ? " (per ?host übersteuert)" : ""}</span>
  <h1>Willkommen bei der Beispiel GmbH</h1>
  <p class="lead">Diese Seite tut so, als wäre sie die Website eines HallofHelp-Kunden.
  Unten rechts schwebt der Hilfe-Button — geladen mit exakt dem Snippet, das Kunden
  in ihren Instanz-Einstellungen kopieren.</p>

  <h2>Was hier getestet wird</h2>
  <p>Der Loader läuft auf einem fremden Origin (Cross-Origin-Einbettung wie beim echten
  Kunden): Button-Injektion, iframe auf <code>${origin}/widget</code>, postMessage-Handshake
  (Brand-Farbe), KI-Fragen, Feedback und Besucher-Zählung (MAU/Credits der Ziel-Instanz).</p>

  <div class="card">
    <small>Verwendetes Original-Snippet</small>
    <pre>${snippetShown}</pre>
  </div>

  <h2>Andere Instanz testen</h2>
  <p>Ziel-Host per Query-Parameter wechseln — z.&nbsp;B. eine Kunden-Instanz oder lokal:</p>
  <form class="host" method="get" action="/">
    <input name="host" placeholder="z. B. demo.hallofhelp.com" value="${host}">
    <button type="submit">Wechseln</button>
  </form>
  <p><small>Beispiele: <a href="/?host=app.hallofhelp.com">app.hallofhelp.com</a> ·
  <a href="/?host=demo.hallofhelp.com">demo.hallofhelp.com</a> ·
  <a href="/?host=app.localhost:3005">app.localhost:3005</a> (nur wenn diese Demo selbst
  lokal über http läuft — eine https-Seite darf kein http-Script laden)</small></p>

  <h2>Etwas Fülltext zum Scrollen</h2>
  <p>Damit sich das Widget wie auf einer echten Seite verhält, steht hier Inhalt:
  Die Beispiel GmbH liefert seit 1987 ausgezeichnete Beispiele — höchste Beispielqualität,
  klimaneutral erzeugt, jederzeit reproduzierbar.</p>
  <p>Häufige Fragen unserer Beispielkunden beantwortet der Hilfe-Button unten rechts.
  Stellen Sie dort ruhig eine echte Frage an die Ziel-Instanz — die Antwort kommt aus
  deren Artikeln (und zählt dort als echte Nutzung!).</p>

  <footer>Interne Testseite von HallofHelp — kein echtes Angebot. Nicht indexierbar.</footer>
</main>
${snippet}
</body>
</html>`;
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname !== "/") return new Response("Not found", { status: 404 });

    const fallback = parseTenantHost(env.TENANT_HOST ?? null) ?? {
      host: "app.hallofhelp.com",
      origin: "https://app.hallofhelp.com",
    };
    const override = parseTenantHost(url.searchParams.get("host"));
    const target = override ?? fallback;

    return new Response(page(target.host, target.origin, override !== null), {
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "no-store",
        "x-robots-tag": "noindex, nofollow",
        "x-content-type-options": "nosniff",
      },
    });
  },
};
