import type { Tenant } from "@/lib/tenant/types";
import { getDbSafe } from "@/server/db/client";
import { evaluatePlanState, type PlanStatus } from "./plan-state";
import {
  computeOverage,
  periodOf,
  periodResetMs,
  PLAN_ORDER,
  PLANS,
  type PlanId,
} from "./pricing";
import { D1BillingRepository, type FeedbackStats, type TopArticleRow } from "./store";

/**
 * SERVER-EINSTIEGE der Admin-Seiten (Muster content/runtime.ts: Seiten sind
 * Server-Komponenten und lesen direkt, ohne HTTP-Umweg). `null` = kein D1
 * (reines `next dev` ohne Wrangler / Build) → die Seiten zeigen ehrliche
 * Null-/Leerzustände, KEINE erfundenen Zahlen (Regel „keine Mockdaten mehr",
 * 2026-07-15).
 */

export interface PlanOverview {
  planId: PlanId;
  baseFeeCents: number;
  includedCredits: number;
  mauLimit: number;
  creditsUsed: number;
  mauCount: number;
  status: PlanStatus;
  graceDaysLeft: number | null;
  overageCredits: number;
  overageAmountCents: number;
  /** Beginn der nächsten Periode (= Credit-Reset), ms UTC. */
  resetMs: number;
  /** Plan-Karten fürs UI (aufsteigend, aktueller markiert). */
  plans: {
    id: PlanId;
    baseFeeCents: number;
    includedCredits: number;
    current: boolean;
    /** true = kein Self-Service-Preis, UI zeigt Vertriebs-Kontakt (Enterprise). */
    contactSales: boolean;
  }[];
}

export async function getPlanOverview(tenant: Tenant): Promise<PlanOverview | null> {
  const db = await getDbSafe();
  if (!db) return null;
  const repo = new D1BillingRepository(db);

  const nowMs = Date.now();
  const nowSec = Math.floor(nowMs / 1000);
  const [row, usage] = await Promise.all([
    repo.getPlanRow(tenant.id),
    repo.getUsage(tenant.id, periodOf(nowMs)),
  ]);
  const state = evaluatePlanState({
    plan: row.plan,
    creditsUsed: usage.creditsUsed,
    mauCount: usage.mauCount,
    overLimitSince: row.overLimitSince,
    nowSec,
  });
  const overage = computeOverage(state.plan, usage.creditsUsed);

  return {
    planId: row.plan,
    baseFeeCents: state.plan.baseFeeCents,
    includedCredits: state.plan.includedCredits,
    mauLimit: state.plan.mauLimit,
    creditsUsed: usage.creditsUsed,
    mauCount: usage.mauCount,
    status: state.status,
    graceDaysLeft: state.graceDaysLeft,
    overageCredits: overage.overageCredits,
    overageAmountCents: overage.amountCents,
    resetMs: periodResetMs(nowMs),
    plans: PLAN_ORDER.map((id) => ({
      id,
      baseFeeCents: PLANS[id].baseFeeCents,
      includedCredits: PLANS[id].includedCredits,
      current: id === row.plan,
      // Enterprise: kein Self-Service-Preis → Plan-Seite zeigt Vertriebs-CTA.
      contactSales: PLANS[id].contactSales === true,
    })),
  };
}

export interface StatsOverview {
  /** Views je Tag (30 Tage, ältester zuerst, interne ausgeblendet). */
  series: number[];
  topArticles: TopArticleRow[];
  totalViews: number;
  /** Vergleichsfenster davor (für den Trend); null bei leerer Basis. */
  deltaPct: number | null;
  /** „War das hilfreich?"-Stimmen (Artikel + KI-Antworten, gleiches Fenster). */
  feedback: FeedbackStats;
}

const STATS_DAYS = 30;

/**
 * @param opts.includeInternal Team-Aufrufe MIT anzeigen (Statistik-Schalter;
 *   Architektur-Default bleibt „ausgeblendet"). Interne Nutzung kostet in
 *   keinem Fall Credits — der Schalter ändert nur die Sichtbarkeit.
 */
export async function getStatsOverview(
  tenant: Tenant,
  opts: { includeInternal?: boolean } = {},
): Promise<StatsOverview | null> {
  const db = await getDbSafe();
  if (!db) return null;
  const repo = new D1BillingRepository(db);
  const nowSec = Math.floor(Date.now() / 1000);

  const window = { days: STATS_DAYS, excludeInternal: !opts.includeInternal, nowSec };
  const [series, topArticles, total60, feedback] = await Promise.all([
    repo.getDailyViews(tenant.id, window),
    repo.getTopArticles(tenant.id, window, 5),
    repo.getViewTotal(tenant.id, { ...window, days: STATS_DAYS * 2 }),
    repo.getFeedbackStats(tenant.id, window),
  ]);
  const totalViews = series.reduce((a, b) => a + b, 0);
  const prevTotal = total60 - totalViews;
  const deltaPct = prevTotal > 0 ? Math.round(((totalViews - prevTotal) / prevTotal) * 100) : null;

  return { series, topArticles, totalViews, deltaPct, feedback };
}

export interface AdminUsageKpis {
  views30: number;
  viewsDeltaPct: number | null;
  viewsSpark: number[];
  mauCount: number;
  creditsUsed: number;
}

/** Kennzahlen der Admin-Übersicht (Views/MAU/Credits — Artikelzahl liefert content/runtime). */
export async function getAdminUsageKpis(tenant: Tenant): Promise<AdminUsageKpis | null> {
  const [stats, plan] = await Promise.all([getStatsOverview(tenant), getPlanOverview(tenant)]);
  if (!stats || !plan) return null;
  return {
    views30: stats.totalViews,
    viewsDeltaPct: stats.deltaPct,
    viewsSpark: stats.series,
    mauCount: plan.mauCount,
    creditsUsed: plan.creditsUsed,
  };
}
