import type { Child } from "hono/jsx";
import type { PlanState } from "@product/server/billing/plan-state";

/**
 * UI-Bausteine des Ops-Dashboards (hono/jsx, server-gerendert, deutsch —
 * internes Betreiber-Tool, bewusst OHNE das Produkt-i18n-System). Farben =
 * Design-Token-Werte des Produkts (globals.css), light+dark via
 * prefers-color-scheme.
 */

/** Fiktive Endkunden-Website zum Widget-Testen (widget-demo/, workers.dev).
 *  `?host=<host>` wählt die Ziel-Instanz. */
export const WIDGET_DEMO_URL = "https://hallofhelp-widget-demo.kevin-kvano.workers.dev";

const CSS = `
:root{--bg:#faf9f7;--surface:#fff;--tint:#f1efeb;--ink:#1a1a1a;--ink-muted:#6b6b6b;
--hairline:#e5e2dc;--brand:#4f46e5;--ok:#0f7b4d;--ok-bg:#e7f5ee;--warn:#8a6100;--warn-bg:#fdf3d8;
--crit:#b3261e;--crit-bg:#fdeceb;}
@media (prefers-color-scheme: dark){:root{--bg:#161513;--surface:#201f1c;--tint:#2a2926;
--ink:#f2f1ef;--ink-muted:#a8a6a1;--hairline:#3a3833;--brand:#8b85f0;--ok:#4ade80;--ok-bg:#12301f;
--warn:#fbbf24;--warn-bg:#332a10;--crit:#f87171;--crit-bg:#3a1917;}}
*{box-sizing:border-box;margin:0}
body{font:15px/1.5 -apple-system,system-ui,sans-serif;background:var(--bg);color:var(--ink);padding:0 0 48px}
a{color:var(--brand);text-decoration:none}a:hover{text-decoration:underline}
header.top{display:flex;align-items:center;gap:14px;padding:14px 28px;border-bottom:1px solid var(--hairline);background:var(--surface)}
header.top .who{margin-left:auto;color:var(--ink-muted);font-size:13px}
main{max-width:1200px;margin:0 auto;padding:24px 28px}
h1{font-size:22px;margin:6px 0 18px}h2{font-size:15px;margin:26px 0 10px;color:var(--ink-muted);font-weight:600}
.grid{display:grid;gap:12px;grid-template-columns:repeat(auto-fit,minmax(170px,1fr))}
.card{background:var(--surface);border:1px solid var(--hairline);border-radius:12px;padding:14px 16px}
.kpi b{display:block;font-size:24px;margin-top:2px}
.kpi span{color:var(--ink-muted);font-size:12.5px}
table{width:100%;border-collapse:collapse;background:var(--surface);border:1px solid var(--hairline);border-radius:12px;overflow:hidden}
th,td{text-align:left;padding:9px 12px;border-bottom:1px solid var(--hairline);font-size:13.5px;vertical-align:top}
th{font-size:11.5px;text-transform:uppercase;letter-spacing:.04em;color:var(--ink-muted);background:var(--tint)}
tr:last-child td{border-bottom:0}
td.num,th.num{text-align:right;font-variant-numeric:tabular-nums}
.badge{display:inline-block;padding:2px 9px;border-radius:999px;font-size:12px;font-weight:600}
.b-ok{background:var(--ok-bg);color:var(--ok)}.b-warn{background:var(--warn-bg);color:var(--warn)}
.b-crit{background:var(--crit-bg);color:var(--crit)}.b-mut{background:var(--tint);color:var(--ink-muted)}
.bars{display:flex;align-items:flex-end;gap:2px;height:56px}
.bars i{flex:1;background:var(--brand);opacity:.75;border-radius:2px 2px 0 0;min-height:2px}
.bars i.g{background:var(--ok)}
form.inline{display:flex;flex-wrap:wrap;gap:10px;align-items:flex-end}
label{display:block;font-size:12px;color:var(--ink-muted);margin-bottom:3px}
input,select{padding:8px 10px;border:1px solid var(--hairline);border-radius:8px;background:var(--surface);color:var(--ink);font-size:14px}
button{padding:9px 16px;border:0;border-radius:999px;background:var(--brand);color:#fff;font-weight:600;font-size:13.5px;cursor:pointer}
button:hover{filter:brightness(1.08)}
.note{padding:10px 14px;border-radius:10px;font-size:13.5px;margin:0 0 16px}
.note.ok{background:var(--ok-bg);color:var(--ok)}.note.err{background:var(--crit-bg);color:var(--crit)}
.muted{color:var(--ink-muted)}.mono{font-family:ui-monospace,monospace;font-size:12.5px}
.row{display:flex;gap:18px;flex-wrap:wrap}.row>.card{flex:1;min-width:280px}
dl{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;font-size:13.5px}
dt{color:var(--ink-muted)}dd{margin:0}
`;

export function Layout({ email, children }: { email: string; children?: Child }) {
  return (
    <html lang="de">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="robots" content="noindex, nofollow" />
        <title>HallofHelp Ops</title>
        <style>{CSS}</style>
      </head>
      <body>
        <header class="top">
          <strong>HallofHelp · Ops</strong>
          <a href="/">Übersicht</a>
          <a href="/new">Neue Instanz</a>
          <a href="/kosten">Selbstkosten</a>
          <a href={WIDGET_DEMO_URL} target="_blank" rel="noopener">
            Widget-Demo ↗
          </a>
          <span class="who">{email}</span>
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}

export function StatusBadge({ state }: { state: PlanState }) {
  if (state.status === "frozen") return <span class="badge b-crit">Eingefroren</span>;
  if (state.status === "over_limit") {
    return <span class="badge b-warn">Limit ({state.graceDaysLeft ?? 0} T. Kulanz)</span>;
  }
  return <span class="badge b-ok">Aktiv</span>;
}

export function RoleBadge({ role }: { role: string }) {
  const cls = role === "owner" ? "b-crit" : role === "admin" ? "b-warn" : role === "content" ? "b-ok" : "b-mut";
  return <span class={`badge ${cls}`}>{role}</span>;
}

/** Mini-Balkenchart (SVG-frei: Flex-Balken; title = Tages-Tooltip). */
export function Bars({ values, green }: { values: number[]; green?: boolean }) {
  const max = Math.max(1, ...values);
  return (
    <div class="bars">
      {values.map((v) => (
        <i class={green ? "g" : ""} style={`height:${Math.round((v / max) * 100)}%`} title={String(v)} />
      ))}
    </div>
  );
}

export const nf = new Intl.NumberFormat("de-DE");
export const df = new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" });
export const eur = new Intl.NumberFormat("de-DE", { style: "currency", currency: "EUR" });

/**
 * Datum robust formatieren: unixepoch-Sekunden (Direkt-SQL/Migrationen) ODER
 * ISO-String (better-auth schreibt Date-Strings) — Live-Fund 2026-07-17.
 */
export function fmtDate(value: number | string | null): string {
  if (value === null || value === undefined || value === "") return "—";
  const d = typeof value === "number" ? new Date(value * 1000) : new Date(value);
  return Number.isNaN(d.getTime()) ? "—" : df.format(d);
}
