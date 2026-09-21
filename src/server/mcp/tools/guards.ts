import { readPlanState } from "@/server/billing/store";
import type { ToolContext } from "./types";

/**
 * Ist die Instanz wegen ihres Plans gesperrt? Schreibende Werkzeuge fragen
 * das, bevor sie etwas ändern.
 *
 * Stand bis hierher zeichengleich doppelt (write.ts und navigation.ts); mit
 * dem Farbwelt-Zugang wäre es die dritte Kopie geworden, und Kopien driften.
 *
 * NUR die Prüfung ist hier, NICHT die Antwort: Die Aufrufer melden denselben
 * Zustand heute mit verschiedenen Codes (`payment_required` in write/
 * destructive/updates, `plan_frozen` in navigation — und die HTTP-Schicht
 * benutzt durchgehend `plan_frozen`). Das ist ein Widerspruch, aber ein
 * vorgefundener: Fehlercodes sind Vertrag gegenüber der Kunden-KI und werden
 * nicht nebenbei im Zuge einer anderen Änderung vereinheitlicht.
 *
 * Ohne Billing-Bindings (dev/Tests) gilt bewusst NICHT gesperrt: Eine
 * fehlende Anbindung darf keine Instanz lahmlegen. Die echte Sperre sitzt
 * ohnehin zusätzlich in der HTTP-Schicht (contentFreeze).
 */
export async function frozen(ctx: ToolContext): Promise<boolean> {
  const billing = await ctx.deps.getBillingDeps?.();
  if (!billing) return false;
  const state = await readPlanState(billing.repo, ctx.tenant.id, ctx.nowSec);
  return state.status === "frozen";
}
