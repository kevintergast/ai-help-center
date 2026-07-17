/**
 * WIDGET-LOADER (Bauphase Widget): das eine Script-Tag, das Kunden auf ihrer
 * Website einbetten (Snippet in den Einstellungen):
 *
 *   <script src="https://<slug>.hallofhelp.com/widget.js" async></script>
 *
 * Dependency-freie IIFE: rendert den Launcher-Button (unten rechts) und ein
 * verstecktes iframe auf /widget DESSELBEN Origins (kein CORS, Branding und
 * APIs first-party im iframe). Kommunikation per postMessage, origin-geprüft:
 *   hoh:ready {color} → Button auf Brand-Farbe einfärben
 *   hoh:close         → Panel schließen
 * KEIN Nutzer-Input im Template — der String ist statisch (kein XSS-Vektor).
 * Statisch cachebar (1 h, immutable wäre falsch: Loader soll updatebar sein).
 */

const LOADER_JS = `(function () {
  if (window.__hohWidget) return;
  window.__hohWidget = 1;

  var script = document.currentScript;
  var origin;
  try {
    origin = new URL(script && script.src ? script.src : "").origin;
  } catch (e) {
    return;
  }

  var open = false;

  var frame = document.createElement("iframe");
  frame.src = origin + "/widget";
  frame.title = "Hilfe-Widget";
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText =
    "position:fixed;z-index:2147483646;border:0;display:none;background:transparent;" +
    "box-shadow:0 12px 40px rgba(0,0,0,.22);border-radius:16px;" +
    "right:20px;bottom:92px;width:380px;max-width:calc(100vw - 32px);" +
    "height:600px;max-height:calc(100dvh - 112px);";

  var btn = document.createElement("button");
  btn.type = "button";
  btn.setAttribute("aria-label", "Hilfe \\u00f6ffnen");
  btn.style.cssText =
    "position:fixed;z-index:2147483647;right:20px;bottom:20px;width:56px;height:56px;" +
    "border-radius:9999px;border:0;cursor:pointer;background:#4f46e5;color:#fff;" +
    "box-shadow:0 8px 24px rgba(0,0,0,.28);display:grid;place-items:center;padding:0;";
  btn.innerHTML =
    '<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"/></svg>';

  function setOpen(next) {
    open = next;
    frame.style.display = open ? "block" : "none";
    frame.setAttribute("aria-hidden", open ? "false" : "true");
    btn.setAttribute("aria-label", open ? "Hilfe schlie\\u00dfen" : "Hilfe \\u00f6ffnen");
  }

  btn.addEventListener("click", function () {
    setOpen(!open);
  });

  window.addEventListener("message", function (event) {
    if (event.origin !== origin || !event.data || typeof event.data !== "object") return;
    if (event.data.type === "hoh:ready" && typeof event.data.color === "string" && event.data.color) {
      btn.style.background = event.data.color;
    } else if (event.data.type === "hoh:close") {
      setOpen(false);
    }
  });

  function mount() {
    document.body.appendChild(frame);
    document.body.appendChild(btn);
  }
  if (document.body) mount();
  else document.addEventListener("DOMContentLoaded", mount);
})();
`;

export function GET(): Response {
  return new Response(LOADER_JS, {
    headers: {
      "content-type": "text/javascript; charset=utf-8",
      "cache-control": "public, max-age=3600",
      "x-content-type-options": "nosniff",
    },
  });
}
