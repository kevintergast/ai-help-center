import type { Context, Next } from "hono";
import type { ApiDeps, ApiEnv } from "@/server/api/context";
import { readPlanState } from "./store";

/**
 * FREEZE-GATE (Infra-Plan Schritt 4; Billing-Entscheidung „Buffer + Freeze").
 *
 * Nach abgelaufener Grace (Status `frozen`) sind INHALTS-/BRANDING-Mutationen
 * gesperrt (402 `plan_frozen`) — Inhalte bleiben sichtbar, nichts wird
 * gelöscht. Lesen (GET/HEAD/OPTIONS) bleibt frei. Team-/Legal-/Plan-Routen
 * werden BEWUSST nicht gegated: Konto-Verwaltung und Rechtspflichten müssen
 * auch im Freeze bedienbar bleiben (und Upgrade sowieso).
 *
 * Reihenfolge: läuft NACH der Default-Deny-Middleware (Anonyme sind längst
 * 401) und VOR den Routern — der 402 ist also nie ein Auth-Bypass-Orakel.
 * Kommende KI-Endpunkte (RAG) nutzen dasselbe Gate; dort blockt zusätzlich
 * bereits `over_limit` im Free-Plan die Generierung (Credit-Gate VOR dem
 * AI-Aufruf = Kosten-Leitplanke).
 */
export function freezeGate(deps: ApiDeps) {
  return async (c: Context<ApiEnv>, next: Next) => {
    const method = c.req.method.toUpperCase();
    if (method === "GET" || method === "HEAD" || method === "OPTIONS") return next();

    const billing = await deps.getBillingDeps?.();
    // Ohne D1 keine Plan-Daten: die Fach-Router antworten dann ohnehin 503
    // fail-closed — das Gate erfindet keinen eigenen Zustand.
    if (!billing) return next();

    const state = await readPlanState(
      billing.repo,
      c.get("tenant").id,
      Math.floor(Date.now() / 1000),
    );
    if (state.status === "frozen") return c.json({ error: "plan_frozen" }, 402);
    return next();
  };
}
