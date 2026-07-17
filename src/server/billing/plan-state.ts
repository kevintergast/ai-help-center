import { PLANS, type PlanDef, type PlanId } from "./pricing";

/**
 * PLAN-/LIMIT-STATUSKETTE (Billing-Entscheidung: 1-Monats-Buffer + Freeze).
 * Reine Funktion — der Status wird LAZY aus (Plan, Verbrauch, over_limit_since)
 * abgeleitet, es gibt keinen Scheduler und keinen persistierten Status, der
 * driften könnte.
 *
 *  - `active`     — im Limit (oder bezahlter Plan mit Credit-Overage: das ist
 *                   metered Mehrverbrauch, KEIN Limit-Verstoß).
 *  - `over_limit` — Limit verletzt (Free: Credits ODER MAU; Paid: nur MAU),
 *                   Service läuft die Grace-Zeit normal weiter (Banner/Mail).
 *  - `frozen`     — Grace abgelaufen: KI aus, keine Inhalts-/Branding-Updates,
 *                   Inhalte bleiben SICHTBAR (nichts wird gelöscht). Upgrade
 *                   (bzw. neue Periode unterm Limit) hebt den Zustand auf.
 */

export const GRACE_DAYS = 30;
const GRACE_SECONDS = GRACE_DAYS * 24 * 60 * 60;

export type PlanStatus = "active" | "over_limit" | "frozen";

export interface PlanStateInput {
  plan: PlanId;
  /** Credits der AKTUELLEN Periode. */
  creditsUsed: number;
  /** Deduplizierte MAU der AKTUELLEN Periode. */
  mauCount: number;
  /** Persistierter Grace-Beginn (unixepoch Sekunden) oder null. */
  overLimitSince: number | null;
  /**
   * Per-Instanz-RAHMEN (Migration 0022, Ops-Verwaltung — primär Enterprise):
   * überschreibt die Plan-Standardwerte aus pricing.ts. Das EFFEKTIVE PlanDef
   * (PlanState.plan) trägt diese Werte — Enforcement, Kunden-Admin und Ops
   * rechnen damit automatisch mit denselben Deckeln.
   */
  customIncludedCredits?: number | null;
  customMauLimit?: number | null;
  /** Jetzt (unixepoch Sekunden). */
  nowSec: number;
}

export interface PlanState {
  status: PlanStatus;
  plan: PlanDef;
  /** Limit aktuell verletzt? (Basis für das Setzen/Löschen des Markers.) */
  isOver: boolean;
  overCredits: boolean;
  overMau: boolean;
  /** Ende der Grace (unixepoch Sekunden) — nur in over_limit/frozen gesetzt. */
  graceUntilSec: number | null;
  /** Volle Resttage der Grace (0 = läuft heute ab) — nur in over_limit. */
  graceDaysLeft: number | null;
}

export function evaluatePlanState(input: PlanStateInput): PlanState {
  const base = PLANS[input.plan];
  // Effektiver Plan = Standard + per-Instanz-Overrides (nur wo gesetzt).
  const plan =
    input.customIncludedCredits != null || input.customMauLimit != null
      ? {
          ...base,
          includedCredits: input.customIncludedCredits ?? base.includedCredits,
          mauLimit: input.customMauLimit ?? base.mauLimit,
        }
      : base;

  // Free ohne kaufbares Overage: Credits-Überschreitung IST ein Limit-Verstoß.
  // Bezahlte Pläne: Credits über dem Kontingent sind metered Overage (aktiv);
  // nur die MAU-Obergrenze bleibt ein harter Verstoß.
  const overCredits = plan.overagePackCents === null && input.creditsUsed > plan.includedCredits;
  const overMau = input.mauCount > plan.mauLimit;
  const isOver = overCredits || overMau;

  if (!isOver) {
    // Marker ggf. veraltet (neue Periode, Upgrade) — der Aufrufer löscht ihn
    // über syncOverLimitMarker; der abgeleitete Status ist sofort korrekt.
    return {
      status: "active",
      plan,
      isOver,
      overCredits,
      overMau,
      graceUntilSec: null,
      graceDaysLeft: null,
    };
  }

  // Verstoß ohne persistierten Beginn: Grace beginnt JETZT (der Verbuchungs-
  // pfad persistiert den Marker im selben Zug — fail-safe Richtung Kulanz).
  const since = input.overLimitSince ?? input.nowSec;
  const graceUntilSec = since + GRACE_SECONDS;
  if (input.nowSec >= graceUntilSec) {
    return { status: "frozen", plan, isOver, overCredits, overMau, graceUntilSec, graceDaysLeft: 0 };
  }
  return {
    status: "over_limit",
    plan,
    isOver,
    overCredits,
    overMau,
    graceUntilSec,
    graceDaysLeft: Math.floor((graceUntilSec - input.nowSec) / 86_400),
  };
}
