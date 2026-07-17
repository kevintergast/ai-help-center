import { evaluatePlanState, type PlanState } from "./plan-state";
import {
  creditsFor,
  periodOf,
  type PlanId,
  type UsageActorType,
  type UsageEventType,
} from "./pricing";

// Re-Export: der Akteurs-Typ lebt jetzt bei der Preisregel (creditsFor),
// bestehende Importe aus store.ts bleiben gültig.
export type { UsageActorType };

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
/** Feedback: gleiche Richtung + Ziel + Besucher max. 1×/24h (Klick-Spam). */
export const FEEDBACK_DEDUP_WINDOW_SEC = 24 * 60 * 60;


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

export interface FeedbackStats {
  /** Stimmen je Artikel-ID (nur Artikel MIT Feedback im Fenster). */
  byArticle: Record<string, { helpful: number; unhelpful: number }>;
  /** Stimmen zu KI-Antworten (Events mit article_id NULL). */
  answers: { helpful: number; unhelpful: number };
}

export interface RecordGenerationInput {
  tenantId: string;
  actorType: UsageActorType;
  visitorId: string;
  userId?: string | null;
  nowSec: number;
  /** Zitierte Artikel (je einer ein ai_source-Event, 0 Credits — Stats/Score). */
  citedArticleIds?: string[];
}

export interface RecordFeedbackInput {
  tenantId: string;
  /** Artikel-Slug oder null = Feedback zu einer KI-Antwort. */
  slug: string | null;
  helpful: boolean;
  actorType: UsageActorType;
  visitorId: string;
  userId?: string | null;
  nowSec: number;
}

export interface BillingRepository {
  /**
   * Verbucht einen Artikel-Aufruf: Event (append-only) + MAU-Dedup + atomares
   * Credit-Inkrement + over_limit-Marker-Sync. Liefert den frischen Plan-State
   * (null bei unknown_article/deduped — nichts verbucht).
   */
  recordView(input: RecordViewInput): Promise<{ result: RecordViewResult; state: PlanState | null }>;
  /**
   * Verbucht eine KI-Generierung (RAG-Kern): Endnutzer 20 Credits; TEAM zum
   * internen Selbstkosten-Satz (creditsFor, Entscheidung 2026-07-16), kein
   * MAU — KEIN Dedup, jede Generierung kostet (Architektur: Regenerieren
   * kostet erneut). Aufruf erst NACH erfolgreicher Generierung.
   */
  recordAiGeneration(input: RecordGenerationInput): Promise<PlanState>;
  /**
   * Verbucht eine KI-ÜBERSETZUNG (bezahltes Team-Feature): IMMER Listenpreis
   * (auch intern — creditsFor), kein MAU, kein Dedup. Aufruf erst NACH
   * erfolgreich angelegter Übersetzung (Fehlschläge kosten nichts).
   */
  recordAiTranslation(input: RecordGenerationInput & { articleId: string }): Promise<PlanState>;
  /**
   * „War das hilfreich?"-Feedback (0 Credits, kein MAU): Event-only fürs
   * Statistik-Aggregat (Hilfreich-Quote). Dedup: gleiche Richtung, gleicher
   * Besucher, gleiches Ziel innerhalb 24h wird verworfen (Klick-Spam);
   * Meinungswechsel (Gegenrichtung) bleibt erlaubt. Unbekannter/unveröffent-
   * lichter Slug wird still verworfen (kein Existenz-Orakel).
   */
  recordFeedback(input: RecordFeedbackInput): Promise<void>;
  /**
   * KI-Generierungen eines Besuchers seit `sinceSec` (Tagesdeckel /ask —
   * Abuse-Härtung: begrenzt, was EIN Besucher an LLM-Kosten auslösen kann).
   */
  countAiGenerationsSince(tenantId: string, visitorId: string, sinceSec: number): Promise<number>;
  /**
   * Feedback-Aggregat fürs Statistik-UI: Stimmen je Artikel + Stimmen zu
   * KI-Antworten (article_id NULL), im Zeitfenster, interne optional raus.
   */
  getFeedbackStats(tenantId: string, opts: StatsWindow): Promise<FeedbackStats>;
  /**
   * „Häufigste Quellen": meistzitierte Artikel in KI-Antworten (ai_source-
   * Events) im Zeitfenster — ersetzt die frühere „Häufigste Fragen"-Karte
   * (Fragetexte werden bewusst NICHT gespeichert).
   */
  getTopSources(tenantId: string, window: StatsWindow, limit: number): Promise<TopArticleRow[]>;
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
          WHERE tenant_id = ? AND visitor_id = ? AND article_id = ?
            AND type = 'article_view' AND created_at > ?
          LIMIT 1`,
      )
      .bind(input.tenantId, input.visitorId, article.id, input.nowSec - VIEW_DEDUP_WINDOW_SEC)
      .first<{ hit: number }>();
    if (recent) return { result: "deduped", state: null };

    const state = await this.charge({
      tenantId: input.tenantId,
      type: "article_view",
      actorType: input.actorType,
      visitorId: input.visitorId,
      userId: input.userId ?? null,
      articleId: article.id,
      nowSec: input.nowSec,
    });
    return { result: "recorded", state };
  }

  async recordAiTranslation(
    input: RecordGenerationInput & { articleId: string },
  ): Promise<PlanState> {
    return this.charge({
      tenantId: input.tenantId,
      type: "ai_translation",
      actorType: input.actorType,
      visitorId: input.visitorId,
      userId: input.userId ?? null,
      articleId: input.articleId,
      nowSec: input.nowSec,
    });
  }

  async recordAiGeneration(input: RecordGenerationInput): Promise<PlanState> {
    const state = await this.charge({
      tenantId: input.tenantId,
      type: "ai_generation",
      actorType: input.actorType,
      visitorId: input.visitorId,
      userId: input.userId ?? null,
      articleId: null,
      nowSec: input.nowSec,
    });

    // Quellen-Events (0 Credits, Event-only): Rohdaten für „Häufigste
    // Quellen" und den späteren Artikel-Beitrags-Score. Bewusst NACH dem
    // Charge und ohne MAU/usage-Inkremente.
    const cited = [...new Set(input.citedArticleIds ?? [])];
    if (cited.length > 0) {
      await this.db.batch(
        cited.map((articleId) =>
          this.db
            .prepare(
              `INSERT INTO usage_events
                 (id, tenant_id, type, credits, actor_type, visitor_id, user_id, article_id, created_at)
               VALUES (?, ?, 'ai_source', 0, ?, ?, ?, ?, ?)`,
            )
            .bind(
              crypto.randomUUID(),
              input.tenantId,
              input.actorType,
              input.visitorId,
              input.userId ?? null,
              articleId,
              input.nowSec,
            ),
        ),
      );
    }
    return state;
  }

  async recordFeedback(input: RecordFeedbackInput): Promise<void> {
    // Ziel auflösen: Artikel (nur veröffentlicht) oder KI-Antwort (slug null).
    let articleId: string | null = null;
    if (input.slug !== null) {
      const article = await this.db
        .prepare(
          `SELECT id FROM articles WHERE tenant_id = ? AND slug = ? AND status = 'published'`,
        )
        .bind(input.tenantId, input.slug)
        .first<{ id: string }>();
      if (!article) return; // still verwerfen (kein Existenz-Orakel)
      articleId = article.id;
    }

    const type = input.helpful ? "feedback_helpful" : "feedback_unhelpful";
    const recent = await this.db
      .prepare(
        `SELECT 1 AS hit FROM usage_events
          WHERE tenant_id = ? AND visitor_id = ? AND type = ?
            AND article_id ${articleId === null ? "IS NULL" : "= ?"} AND created_at > ?
          LIMIT 1`,
      )
      .bind(
        input.tenantId,
        input.visitorId,
        type,
        ...(articleId === null ? [] : [articleId]),
        input.nowSec - FEEDBACK_DEDUP_WINDOW_SEC,
      )
      .first<{ hit: number }>();
    if (recent) return; // Klick-Spam gleicher Richtung

    // Event-only (0 Credits): bewusst OHNE charge() — kein MAU, kein
    // tenant_usage-Inkrement, kein Marker-Sync. Nur Statistik-Rohdatum.
    await this.db
      .prepare(
        `INSERT INTO usage_events
           (id, tenant_id, type, credits, actor_type, visitor_id, user_id, article_id, created_at)
         VALUES (?, ?, ?, 0, ?, ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        input.tenantId,
        type,
        input.actorType,
        input.visitorId,
        input.userId ?? null,
        articleId,
        input.nowSec,
      )
      .run();
  }

  async countAiGenerationsSince(
    tenantId: string,
    visitorId: string,
    sinceSec: number,
  ): Promise<number> {
    const row = await this.db
      .prepare(
        `SELECT COUNT(*) AS n FROM usage_events
          WHERE tenant_id = ? AND visitor_id = ? AND type = 'ai_generation' AND created_at > ?`,
      )
      .bind(tenantId, visitorId, sinceSec)
      .first<{ n: number }>();
    return row?.n ?? 0;
  }

  /**
   * Gemeinsamer Verbuchungspfad (View + Generierung): Event (append-only) +
   * MAU-Dedup + atomares Credit-Inkrement in EINER Transaktion, danach
   * Plan-State + over_limit-Marker-Sync. Interne (Team-)Aufrufe: Event fürs
   * Statistik-Filtern, KEIN MAU; Credits nach der zentralen Preisregel
   * `creditsFor` — für Team 0, AUSSER KI-Generierungen (interner
   * Selbstkosten-Satz, Entscheidung 2026-07-16).
   */
  private async charge(input: {
    tenantId: string;
    type: UsageEventType;
    actorType: UsageActorType;
    visitorId: string;
    userId: string | null;
    articleId: string | null;
    nowSec: number;
  }): Promise<PlanState> {
    const internal = input.actorType === "internal";
    const credits = creditsFor(input.type, input.actorType);
    const period = periodOf(input.nowSec * 1000);

    const statements = [
      this.db
        .prepare(
          `INSERT INTO usage_events
             (id, tenant_id, type, credits, actor_type, visitor_id, user_id, article_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          input.tenantId,
          input.type,
          credits,
          input.actorType,
          input.visitorId,
          input.userId,
          input.articleId,
          input.nowSec,
        ),
    ];
    // MAU zählt nur echte Endnutzer — Team-Mitglieder sind keine „aktiven
    // Nutzer" im Abrechnungssinn.
    if (!internal) {
      statements.push(
        this.db
          .prepare(
            `INSERT OR IGNORE INTO usage_mau (tenant_id, period, visitor_id, first_seen_at)
             VALUES (?, ?, ?, ?)`,
          )
          .bind(input.tenantId, period, input.visitorId, input.nowSec),
      );
    }
    // Credit-Aggregat immer dann, wenn das Event etwas KOSTET — also auch für
    // interne KI-Generierungen (Selbstkosten-Satz).
    if (credits > 0) {
      statements.push(
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
    return state;
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

  async getTopSources(
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
          WHERE e.tenant_id = ? AND e.type = 'ai_source' AND e.created_at >= ?
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

  async getFeedbackStats(tenantId: string, window: StatsWindow): Promise<FeedbackStats> {
    const startSec = startOfUtcDay(window.nowSec) - (window.days - 1) * DAY_SEC;
    const rows = await this.db
      .prepare(
        `SELECT article_id AS articleId, type, COUNT(*) AS n
           FROM usage_events
          WHERE tenant_id = ? AND type IN ('feedback_helpful', 'feedback_unhelpful')
            AND created_at >= ?
            ${window.excludeInternal ? "AND actor_type != 'internal'" : ""}
          GROUP BY article_id, type`,
      )
      .bind(tenantId, startSec)
      .all<{ articleId: string | null; type: string; n: number }>();

    const stats: FeedbackStats = { byArticle: {}, answers: { helpful: 0, unhelpful: 0 } };
    for (const r of rows.results) {
      const key = r.type === "feedback_helpful" ? "helpful" : "unhelpful";
      if (r.articleId === null) {
        stats.answers[key] += r.n;
      } else {
        (stats.byArticle[r.articleId] ??= { helpful: 0, unhelpful: 0 })[key] += r.n;
      }
    }
    return stats;
  }
}
