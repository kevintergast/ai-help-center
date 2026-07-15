import { evaluatePlanState, type PlanState } from "./plan-state";
import { CREDIT_COSTS, periodOf, type PlanId } from "./pricing";

/**
 * METERING-PERSISTENZ (Infra-Plan Schritt 3) auf den 0009-Tabellen.
 *
 * Muster wie branding/store.ts: strukturelles Repository-Interface, D1-
 * Implementierung mit `tenant_id` in JEDER Query, Tests fahren die ECHTE
 * Migrations-DDL über den better-sqlite3-Shim (sqlite-test-support.ts).
 *
 * NEBENLÄUFIGKEIT (bewusste Entscheidung statt Durable Object, s. Plan-Doku):
 * Der Credit-Zähler wird ausschließlich über ein atomares Einzel-Statement
 * inkrementiert (UPSERT `credits_used = credits_used + n`) — parallele Requests
 * serialisiert D1 pro Statement, es gibt keinen Read-Modify-Write. Ein
 * DO-Counter bleibt als Drop-in hinter DIESEM Interface möglich (RAG-Schritt 6),
 * ohne Aufrufer zu ändern. Check-then-charge hat ein tolerierbares Rest-Race
 * (minimaler Überlauf ÜBER dem Limit ist kulanzseitig egal, nie sicherheits-
 * relevant — das harte Gate ist der Freeze-Status VOR teuren KI-Aufrufen).
 */

/** Fenster, in dem derselbe Besucher denselben Artikel nicht doppelt zählt. */
export const VIEW_DEDUP_WINDOW_SEC = 30 * 60;

export type UsageActorType = "anon" | "user" | "internal";

export interface RecordViewInput {
  tenantId: string;
  /** Öffentlicher Artikel-Slug (nur `status='published'` zählt). */
  slug: string;
  actorType: UsageActorType;
  /** Pseudonyme Cookie-ID bzw. `u:<user_id>` — Basis für Dedup + MAU. */
  visitorId: string;
  userId?: string | null;
  nowSec: number;
}

export type RecordViewResult = "recorded" | "deduped" | "unknown_article";

export interface UsageSnapshot {
  creditsUsed: number;
  mauCount: number;
}

export interface PlanRow {
  plan: PlanId;
  overLimitSince: number | null;
}

export interface StatsWindow {
  /** Anzahl Tage rückwirkend (inkl. heute, UTC-Tagesgrenzen). */
  days: number;
  /** Team-Mitglieder ausblenden (Architektur-Entscheidung: Filter im Admin). */
  excludeInternal: boolean;
  nowSec: number;
}

export interface TopArticleRow {
  articleId: string;
  title: string;
  views: number;
}

export interface BillingRepository {
  /**
   * Verbucht einen Artikel-Aufruf: Event (append-only) + MAU-Dedup + atomares
   * Credit-Inkrement + over_limit-Marker-Sync. Liefert den frischen Plan-State
   * (null bei unknown_article/deduped — nichts verbucht).
   */
  recordView(input: RecordViewInput): Promise<{ result: RecordViewResult; state: PlanState | null }>;
  /** Verbrauch der Periode (Credits aus Aggregat, MAU als COUNT über usage_mau). */
  getUsage(tenantId: string, period: string): Promise<UsageSnapshot>;
  /** Plan-Zeile (fehlend = Free, kein Marker). */
  getPlanRow(tenantId: string): Promise<PlanRow>;
  /** Setzt den Grace-Beginn beim ersten Verstoß bzw. löscht ihn, wenn wieder im Limit. */
  syncOverLimitMarker(tenantId: string, isOver: boolean, nowSec: number): Promise<void>;
  /** Views je UTC-Tag, ältester zuerst (Lücken = 0) — für Chart/Sparkline. */
  getDailyViews(tenantId: string, window: StatsWindow): Promise<number[]>;
  /** Meistgesehene Artikel im Fenster (Titel-Join; gelöschte → id als Fallback). */
  getTopArticles(tenantId: string, window: StatsWindow, limit: number): Promise<TopArticleRow[]>;
  /** Gesamt-Views im Fenster (KPI). */
  getViewTotal(tenantId: string, window: StatsWindow): Promise<number>;
}

/** Pro Request aufgelöste Metering-Infrastruktur (null = D1 fehlt → No-op/503). */
export interface BillingDeps {
  repo: BillingRepository;
}

/** Aktuellen Plan-State eines Tenants lesen (gemeinsamer Pfad für Gate + Admin). */
export async function readPlanState(
  repo: BillingRepository,
  tenantId: string,
  nowSec: number,
): Promise<PlanState> {
  const [row, usage] = await Promise.all([
    repo.getPlanRow(tenantId),
    repo.getUsage(tenantId, periodOf(nowSec * 1000)),
  ]);
  return evaluatePlanState({
    plan: row.plan,
    creditsUsed: usage.creditsUsed,
    mauCount: usage.mauCount,
    overLimitSince: row.overLimitSince,
    nowSec,
  });
}

const DAY_SEC = 86_400;

/** UTC-Tagesanfang. */
function startOfUtcDay(sec: number): number {
  return sec - (sec % DAY_SEC);
}

export class D1BillingRepository implements BillingRepository {
  constructor(private readonly db: D1Database) {}

  async recordView(
    input: RecordViewInput,
  ): Promise<{ result: RecordViewResult; state: PlanState | null }> {
    const article = await this.db
      .prepare(`SELECT id FROM articles WHERE tenant_id = ? AND slug = ? AND status = 'published'`)
      .bind(input.tenantId, input.slug)
      .first<{ id: string }>();
    if (!article) return { result: "unknown_article", state: null };

    const recent = await this.db
      .prepare(
        `SELECT 1 AS hit FROM usage_events
          WHERE tenant_id = ? AND visitor_id = ? AND article_id = ? AND created_at > ?
          LIMIT 1`,
      )
      .bind(input.tenantId, input.visitorId, article.id, input.nowSec - VIEW_DEDUP_WINDOW_SEC)
      .first<{ hit: number }>();
    if (recent) return { result: "deduped", state: null };

    // Interne (Team-)Aufrufe: Event fürs Statistik-Filtern, aber 0 Credits,
    // kein MAU — der Tenant zahlt nie für die eigene Pflege-Arbeit.
    const internal = input.actorType === "internal";
    const credits = internal ? 0 : CREDIT_COSTS.article_view;
    const period = periodOf(input.nowSec * 1000);

    const statements = [
      this.db
        .prepare(
          `INSERT INTO usage_events
             (id, tenant_id, type, credits, actor_type, visitor_id, user_id, article_id, created_at)
           VALUES (?, ?, 'article_view', ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          input.tenantId,
          credits,
          input.actorType,
          input.visitorId,
          input.userId ?? null,
          article.id,
          input.nowSec,
        ),
    ];
    if (!internal) {
      statements.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO usage_mau (tenant_id, period, visitor_id, first_seen_at)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(input.tenantId, period, input.visitorId, input.nowSec),
        this.db
          .prepare(
            `INSERT INTO tenant_usage (tenant_id, period, credits_used, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT (tenant_id, period)
             DO UPDATE SET credits_used = credits_used + excluded.credits_used,
                           updated_at   = excluded.updated_at`,
          )
          .bind(input.tenantId, period, credits, input.nowSec),
      );
    }
    await this.db.batch(statements);

    const state = await readPlanState(this, input.tenantId, input.nowSec);
    await this.syncOverLimitMarker(input.tenantId, state.isOver, input.nowSec);
    return { result: "recorded", state };
  }

  async getUsage(tenantId: string, period: string): Promise<UsageSnapshot> {
    const [credits, mau] = await Promise.all([
      this.db
        .prepare(`SELECT credits_used FROM tenant_usage WHERE tenant_id = ? AND period = ?`)
        .bind(tenantId, period)
        .first<{ credits_used: number }>(),
      this.db
        .prepare(`SELECT COUNT(*) AS c FROM usage_mau WHERE tenant_id = ? AND period = ?`)
        .bind(tenantId, period)
        .first<{ c: number }>(),
    ]);
    return { creditsUsed: credits?.credits_used ?? 0, mauCount: mau?.c ?? 0 };
  }

  async getPlanRow(tenantId: string): Promise<PlanRow> {
    const row = await this.db
      .prepare(`SELECT plan, over_limit_since FROM tenant_plan WHERE tenant_id = ?`)
      .bind(tenantId)
      .first<{ plan: PlanId; over_limit_since: number | null }>();
    return row
      ? { plan: row.plan, overLimitSince: row.over_limit_since }
      : { plan: "free", overLimitSince: null };
  }

  async syncOverLimitMarker(tenantId: string, isOver: boolean, nowSec: number): Promise<void> {
    if (isOver) {
      // Erster Verstoß startet die Grace; ein BESTEHENDER Beginn bleibt stehen
      // (COALESCE) — sonst würde jede weitere Buchung die Grace verlängern.
      await this.db
        .prepare(
          `INSERT INTO tenant_plan (tenant_id, plan, over_limit_since, updated_at)
           VALUES (?, 'free', ?, ?)
           ON CONFLICT (tenant_id)
           DO UPDATE SET over_limit_since = COALESCE(tenant_plan.over_limit_since, excluded.over_limit_since),
                         updated_at       = excluded.updated_at`,
        )
        .bind(tenantId, nowSec, nowSec)
        .run();
      return;
    }
    await this.db
      .prepare(
        `UPDATE tenant_plan SET over_limit_since = NULL, updated_at = ?
          WHERE tenant_id = ? AND over_limit_since IS NOT NULL`,
      )
      .bind(nowSec, tenantId)
      .run();
  }

  async getDailyViews(tenantId: string, window: StatsWindow): Promise<number[]> {
    const startSec = startOfUtcDay(window.nowSec) - (window.days - 1) * DAY_SEC;
    // CAST erzwingt Integer-Buckets: je nach Binding-Schicht (better-sqlite3
    // bindet JS-Zahlen als REAL) wäre die Division sonst Fließkomma → die
    // Bucket-Zuordnung liefe ins Leere.
    const rows = await this.db
      .prepare(
        `SELECT CAST((created_at - ?) / ${DAY_SEC} AS INTEGER) AS bucket, COUNT(*) AS views
           FROM usage_events
          WHERE tenant_id = ? AND type = 'article_view' AND created_at >= ?
            ${window.excludeInternal ? "AND actor_type != 'internal'" : ""}
          GROUP BY bucket`,
      )
      .bind(startSec, tenantId, startSec)
      .all<{ bucket: number; views: number }>();

    const series = new Array<number>(window.days).fill(0);
    for (const row of rows.results) {
      if (row.bucket >= 0 && row.bucket < window.days) series[row.bucket] = row.views;
    }
    return series;
  }

  async getTopArticles(
    tenantId: string,
    window: StatsWindow,
    limit: number,
  ): Promise<TopArticleRow[]> {
    const startSec = startOfUtcDay(window.nowSec) - (window.days - 1) * DAY_SEC;
    const rows = await this.db
      .prepare(
        `SELECT e.article_id AS articleId, COUNT(*) AS views, a.title AS title
           FROM usage_events e
           LEFT JOIN articles a ON a.tenant_id = e.tenant_id AND a.id = e.article_id
          WHERE e.tenant_id = ? AND e.type = 'article_view' AND e.created_at >= ?
            ${window.excludeInternal ? "AND e.actor_type != 'internal'" : ""}
          GROUP BY e.article_id
          ORDER BY views DESC, e.article_id
          LIMIT ?`,
      )
      .bind(tenantId, startSec, limit)
      .all<{ articleId: string; views: number; title: string | null }>();
    return rows.results.map((r) => ({
      articleId: r.articleId,
      title: r.title ?? r.articleId,
      views: r.views,
    }));
  }

  async getViewTotal(tenantId: string, window: StatsWindow): Promise<number> {
    const startSec = startOfUtcDay(window.nowSec) - (window.days - 1) * DAY_SEC;
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM usage_events
          WHERE tenant_id = ? AND type = 'article_view' AND created_at >= ?
            ${window.excludeInternal ? "AND actor_type != 'internal'" : ""}`,
      )
      .bind(tenantId, startSec)
      .first<{ c: number }>();
    return row?.c ?? 0;
  }
}
