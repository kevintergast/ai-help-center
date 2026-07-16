/**
 * PREIS-/PLAN-KONFIGURATION (Infra-Plan Schritt 3; Zahlen = bewusste Platzhalter
 * aus der Billing-Entscheidung, final vor Paddle-Launch).
 *
 * Diese Datei ist die EINZIGE Quelle für Credit-Kosten, Plan-Limits und
 * Overage-Preise. Reine Daten + pure Funktionen — kein I/O, kein Provider:
 * Paddle (später) konsumiert dieselben Werte über den provider-agnostischen
 * Billing-Layer, die Berechnung hier ändert sich dadurch nicht.
 *
 * ENTSCHEIDUNG 2026-07-15: erst Metering + echte BERECHNUNG (Anzeige inkl.
 * Overage-Betrag), noch KEINE Zahlungen/Zahlungsmethoden.
 */

/**
 * Verbrauchsarten. `search` ist bewusst 0 (Suche bleibt immer frei);
 * Feedback ist 0 (niemand zahlt dafür, uns Feedback zu geben) — die Richtung
 * steckt im Typ (hilfreich/nicht), damit die Hilfreich-Quote ohne
 * Schemaänderung aus `usage_events` aggregierbar ist.
 */
export const CREDIT_COSTS = {
  article_view: 1,
  ai_generation: 20,
  ai_regeneration: 20,
  search: 0,
  feedback_helpful: 0,
  feedback_unhelpful: 0,
} as const;

export type UsageEventType = keyof typeof CREDIT_COSTS;

/** Akteurs-Klasse eines Usage-Events (Quelle der Wahrheit; store.ts re-exportiert). */
export type UsageActorType = "anon" | "user" | "internal";

/**
 * Interner Selbstkosten-Satz für KI-Generierungen (Entscheidung 2026-07-16):
 * Team-Nutzung ist grundsätzlich kostenlos (eigene Inhalte pflegen kostet
 * nichts) — AUSSER KI-Generierungen, die reale Inferenz-Kosten auslösen. Die
 * zählen zum reduzierten „at cost"-Satz (~Selbstkosten AI+Embedding+Infra,
 * grob „Nullnummer" für den Betreiber), damit Vielnutzung durchs eigene Team
 * sichtbar bleibt und nicht unbepreist untergeht.
 */
export const INTERNAL_AI_GENERATION_CREDITS = 5;

/**
 * Credit-Kosten eines Events nach Akteurs-Klasse — DIE zentrale Preisregel:
 * anonyme/eingeloggte Endnutzer zahlen die Listenpreise; interne (Team-)
 * Aufrufe sind frei bis auf KI-Generierungen (Selbstkosten-Satz, s. o.).
 */
export function creditsFor(type: UsageEventType, actorType: UsageActorType): number {
  if (actorType !== "internal") return CREDIT_COSTS[type];
  return type === "ai_generation" || type === "ai_regeneration"
    ? INTERNAL_AI_GENERATION_CREDITS
    : 0;
}

export type PlanId = "free" | "starter" | "scale" | "enterprise";

export interface PlanDef {
  id: PlanId;
  /** Basis-Gebühr in Cent/Monat (Anzeige; Abbuchung erst mit Paddle). */
  baseFeeCents: number;
  /** Inkludierte Credits pro Abrechnungsmonat. */
  includedCredits: number;
  /** Faire MAU-Obergrenze pro Monat (dedupliziert via visitor_id). */
  mauLimit: number;
  /**
   * Overage: Preis in Cent je angefangenem 5.000er-Credit-Paket über dem
   * Inklusiv-Kontingent. `null` = kein Overage kaufbar (Free) → Überschreitung
   * läuft in over_limit→Grace→Freeze statt in metered Abrechnung.
   */
  overagePackCents: number | null;
  /**
   * Enterprise: kein Self-Service-Preis — Konditionen individuell über den
   * Vertrieb (UI zeigt Kontakt-CTA statt Preis). Die hinterlegten Zahlen sind
   * großzügige Arbeits-Limits für Enterprise-Instanzen (z. B. t_operator),
   * KEINE öffentlichen Preise.
   */
  contactSales?: true;
}

/** Credits pro Overage-Paket (plan-übergreifend gleich, nur der Preis variiert). */
export const OVERAGE_PACK_CREDITS = 5_000;

export const PLANS: Record<PlanId, PlanDef> = {
  free: { id: "free", baseFeeCents: 0, includedCredits: 1_000, mauLimit: 500, overagePackCents: null },
  starter: { id: "starter", baseFeeCents: 4_900, includedCredits: 25_000, mauLimit: 5_000, overagePackCents: 400 },
  scale: { id: "scale", baseFeeCents: 19_900, includedCredits: 150_000, mauLimit: 25_000, overagePackCents: 250 },
  enterprise: {
    id: "enterprise",
    baseFeeCents: 0,
    includedCredits: 1_000_000,
    mauLimit: 100_000,
    overagePackCents: 150,
    contactSales: true,
  },
};

/** Reihenfolge für Plan-Listen im UI (aufsteigend). */
export const PLAN_ORDER: readonly PlanId[] = ["free", "starter", "scale", "enterprise"];

export interface OverageResult {
  /** Credits über dem Inklusiv-Kontingent (0, wenn im Limit). */
  overageCredits: number;
  /** Angefangene Pakete à OVERAGE_PACK_CREDITS. */
  packs: number;
  /** Betrag in Cent (0 bei Free — dort gibt es kein kaufbares Overage). */
  amountCents: number;
}

/** Overage-BERECHNUNG (reine Anzeige/Vorschau, bis Paddle abrechnet). */
export function computeOverage(plan: PlanDef, creditsUsed: number): OverageResult {
  const overageCredits = Math.max(0, creditsUsed - plan.includedCredits);
  if (overageCredits === 0 || plan.overagePackCents === null) {
    return { overageCredits, packs: 0, amountCents: 0 };
  }
  const packs = Math.ceil(overageCredits / OVERAGE_PACK_CREDITS);
  return { overageCredits, packs, amountCents: packs * plan.overagePackCents };
}

/** Abrechnungsperiode (UTC-Kalendermonat) zu einem Zeitpunkt: 'YYYY-MM'. */
export function periodOf(nowMs: number): string {
  const d = new Date(nowMs);
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${d.getUTCFullYear()}-${month}`;
}

/** Beginn der NÄCHSTEN Periode (= Credit-Reset) in ms UTC. */
export function periodResetMs(nowMs: number): number {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1);
}
