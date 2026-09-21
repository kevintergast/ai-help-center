import { readPlanState, D1BillingRepository } from "@product/server/billing/store";
import type { PlanState } from "@product/server/billing/plan-state";
import { computeOverage, periodOf, PLANS } from "@product/server/billing/pricing";

/**
 * LESE-QUERIES des Ops-Dashboards — direkt auf der Produkt-D1 (dieselbe
 * Datenbank, eigenes Binding). Plan-/Preis-WAHRHEIT kommt aus den geteilten
 * Produkt-Modulen (readPlanState/PLANS/computeOverage via @product-Alias) —
 * hier wird bewusst NICHTS davon dupliziert.
 *
 * Alle Queries sind global (Betreiber-Sicht) bzw. explizit tenant-gebunden;
 * die Datenmengen sind Betreiber-klein (volle Scans über usage_events sind
 * v1 in Ordnung — bei Wachstum: Aggregat-Tabellen).
 */

const DAY_SEC = 86_400;

export interface PlatformStats {
  tenants: number;
  creditsUsedPeriod: number;
  mauPeriod: number;
  views30: number;
  generations30: number;
  translations30: number;
  openTickets: number;
  /** 30 Tage, ältester zuerst: Views + KI-Generierungen je Tag (global). */
  series: { views: number[]; generations: number[] };
}

/** Beginn der laufenden Abrechnungsperiode (UTC-Monatsanfang) in Sekunden. */
function periodStartSec(nowSec: number): number {
  const d = new Date(nowSec * 1000);
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 1000);
}

function startOfUtcDay(sec: number): number {
  return sec - (sec % DAY_SEC);
}

export async function platformStats(db: D1Database, nowSec: number): Promise<PlatformStats> {
  const period = periodOf(nowSec * 1000);
  const since30 = startOfUtcDay(nowSec) - 29 * DAY_SEC;

  const [tenants, usage, mau, tickets, byDay] = await Promise.all([
    db.prepare(`SELECT COUNT(*) AS n FROM tenants`).first<{ n: number }>(),
    db
      .prepare(`SELECT COALESCE(SUM(credits_used),0) AS n FROM tenant_usage WHERE period = ?`)
      .bind(period)
      .first<{ n: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM usage_mau WHERE period = ?`)
      .bind(period)
      .first<{ n: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM support_tickets WHERE status = 'open'`)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT CAST((created_at - ?) / 86400 AS INTEGER) AS day, type, COUNT(*) AS n
           FROM usage_events
          WHERE created_at >= ? AND type IN ('article_view','ai_generation','ai_translation')
          GROUP BY day, type`,
      )
      .bind(since30, since30)
      .all<{ day: number; type: string; n: number }>(),
  ]);

  const views = Array.from({ length: 30 }, () => 0);
  const generations = Array.from({ length: 30 }, () => 0);
  let views30 = 0;
  let generations30 = 0;
  let translations30 = 0;
  for (const row of byDay.results) {
    // D1 bindet JS-Zahlen als REAL → ohne CAST käme ein Float-Tag zurück
    // (Array[27.4] = Property statt Index; Live-Fund 2026-07-17).
    const idx = Math.min(29, Math.max(0, Math.floor(row.day)));
    if (row.type === "article_view") {
      views[idx] += row.n;
      views30 += row.n;
    } else if (row.type === "ai_generation") {
      generations[idx] += row.n;
      generations30 += row.n;
    } else if (row.type === "ai_translation") {
      translations30 += row.n;
    }
  }

  return {
    tenants: tenants?.n ?? 0,
    creditsUsedPeriod: usage?.n ?? 0,
    mauPeriod: mau?.n ?? 0,
    views30,
    generations30,
    translations30,
    openTickets: tickets?.n ?? 0,
    series: { views, generations },
  };
}

export interface TenantRow {
  id: string;
  slug: string;
  name: string;
  createdAt: number | null;
  /** Gesetzt = Instanz blockiert (0021) — Auflösung liefert überall 404. */
  suspendedAt: number | null;
  ownerEmail: string | null;
  state: PlanState;
  creditsUsed: number;
  mau: number;
  openTickets: number;
  publishedArticles: number;
  overageCents: number;
  /**
   * GETEILTE HERKUNFT (2026-09-21): Zahl der anonymen Besucher-IDs dieser
   * Periode, die für sich mehr Ereignisse erzeugt haben, als ein Mensch
   * plausibel erzeugt. Solche IDs sind in aller Regel VIELE Menschen hinter
   * einer Adresse mit gleichem Browser (Firmen-NAT, Proxy).
   *
   * WARUM SICHTBAR: Die cookiefreie Zählung (security/visitor-id.ts) kann
   * diese Menschen nicht trennen — die MAU dieser Instanz ist dann eine
   * Untergrenze, keine Zahl. Da die MAU eine HARTE Plan-Grenze ist, wäre das
   * sonst der stille Weg daran vorbei: Wir sähen eine kleine Instanz, wo
   * eine große sitzt. Hier steht sie stattdessen sichtbar in der Liste.
   */
  sharedOriginIds: number;
  /** Anteil der Aufrufe (0–100), der auf diese IDs entfällt. */
  sharedOriginPct: number;
}

/** Basis-Zeile aus `tenants` + Aggregaten (Owner via Subquery). */
interface RawTenantRow {
  id: string;
  slug: string;
  name: string;
  created_at: number | null;
  suspended_at: number | null;
  owner_email: string | null;
  credits_used: number | null;
  mau: number | null;
  open_tickets: number;
  published_articles: number;
}

const TENANT_LIST_SQL = `
  SELECT t.id, t.slug, t.name, t.created_at, t.suspended_at,
         (SELECT u.email FROM auth_user u
           WHERE u.tenant_id = t.id AND u.role = 'owner' LIMIT 1) AS owner_email,
         (SELECT tu.credits_used FROM tenant_usage tu
           WHERE tu.tenant_id = t.id AND tu.period = ?) AS credits_used,
         (SELECT COUNT(*) FROM usage_mau m
           WHERE m.tenant_id = t.id AND m.period = ?) AS mau,
         (SELECT COUNT(*) FROM support_tickets s
           WHERE s.tenant_id = t.id AND s.status = 'open') AS open_tickets,
         (SELECT COUNT(*) FROM articles a
           WHERE a.tenant_id = t.id AND a.status = 'published') AS published_articles
    FROM tenants t`;

/**
 * Ab wie vielen Ereignissen im Monat eine einzelne anonyme ID nicht mehr als
 * eine Person durchgeht. 500 Aufrufe sind gut 16 pro Tag, jeden Tag — das
 * liest kein Mensch in einem Hilfezentrum. Bewusst hoch angesetzt: Die Zahl
 * soll auffällige Fälle zeigen, nicht fleißige Leser verdächtigen.
 */
export const SHARED_ORIGIN_EVENT_THRESHOLD = 500;

/**
 * Anonyme IDs mit unplausibel hohem Aufkommen + ihr Anteil an allen anonymen
 * Aufrufen der Periode. NUR `anon`: Angemeldete zählen über die Nutzer-Id und
 * können gar nicht zusammenfallen.
 */
async function sharedOrigin(
  db: D1Database,
  tenantId: string,
  periodStartSec: number,
): Promise<{ ids: number; pct: number }> {
  const WHERE = `tenant_id = ? AND actor_type = 'anon' AND created_at >= ?`;
  // Zwei Anweisungen statt einer mit nummerierten Platzhaltern: D1 und die
  // sqlite-Testbrücke binden beide streng positionell.
  const [hot, all] = await Promise.all([
    db
      .prepare(
        `SELECT COUNT(*) AS ids, COALESCE(SUM(n), 0) AS hot FROM (
           SELECT COUNT(*) AS n FROM usage_events
            WHERE ${WHERE} GROUP BY visitor_id HAVING COUNT(*) > ?)`,
      )
      .bind(tenantId, periodStartSec, SHARED_ORIGIN_EVENT_THRESHOLD)
      .first<{ ids: number; hot: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS total FROM usage_events WHERE ${WHERE}`)
      .bind(tenantId, periodStartSec)
      .first<{ total: number }>(),
  ]);
  const total = all?.total ?? 0;
  if (!hot || total === 0) return { ids: 0, pct: 0 };
  return { ids: hot.ids, pct: Math.round((hot.hot / total) * 100) };
}

async function toTenantRow(db: D1Database, raw: RawTenantRow, nowSec: number): Promise<TenantRow> {
  // Status über die GETEILTE Produkt-Logik (Plan, over_limit, Grace, Freeze).
  const repo = new D1BillingRepository(db);
  const state = await readPlanState(repo, raw.id, nowSec);
  const overage = computeOverage(PLANS[state.plan.id], raw.credits_used ?? 0);
  const shared = await sharedOrigin(db, raw.id, periodStartSec(nowSec));
  return {
    id: raw.id,
    slug: raw.slug,
    name: raw.name,
    createdAt: raw.created_at,
    suspendedAt: raw.suspended_at,
    ownerEmail: raw.owner_email,
    state,
    creditsUsed: raw.credits_used ?? 0,
    mau: raw.mau ?? 0,
    openTickets: raw.open_tickets,
    publishedArticles: raw.published_articles,
    overageCents: overage.amountCents,
    sharedOriginIds: shared.ids,
    sharedOriginPct: shared.pct,
  };
}

export async function listTenants(db: D1Database, nowSec: number): Promise<TenantRow[]> {
  const period = periodOf(nowSec * 1000);
  const { results } = await db
    .prepare(`${TENANT_LIST_SQL} ORDER BY t.created_at DESC, t.id`)
    .bind(period, period)
    .all<RawTenantRow>();
  const rows: TenantRow[] = [];
  for (const raw of results) rows.push(await toTenantRow(db, raw, nowSec));
  return rows;
}

export interface TenantUser {
  id: string;
  email: string;
  name: string | null;
  role: string;
  emailVerified: number;
  twoFactorEnabled: number;
  banned: number | null;
  createdAt: number | string | null;
  /** Anmeldemethoden aus auth_account: 'credential' (Passwort), 'google', … —
   *  leer = noch kein Login-Verfahren (z. B. Ops-erstellter Owner vor dem
   *  ersten „Passwort vergessen"). */
  providers: string[];
}

export interface PendingInvitation {
  id: string;
  email: string;
  role: string;
  status: string;
  expiresAt: number;
}

export interface TenantDetail {
  row: TenantRow;
  defaultLocale: string;
  seoIndexable: number;
  supportEmail: string | null;
  customDomain: string | null;
  customDomainStatus: string | null;
  draftArticles: number;
  users: TenantUser[];
  invitations: PendingInvitation[];
  /** Views je Tag (30d, ältester zuerst; interne inklusive — Betreiber-Sicht). */
  viewSeries: number[];
  /** Event-Zähler der letzten 30 Tage — Prefill für den Selbstkostenrechner. */
  usage30: { views: number; generations: number; translations: number };
  recentTickets: { id: string; message: string; status: string; createdAt: number }[];
}

export async function tenantDetail(
  db: D1Database,
  tenantId: string,
  nowSec: number,
): Promise<TenantDetail | null> {
  const period = periodOf(nowSec * 1000);
  const raw = await db
    .prepare(`${TENANT_LIST_SQL} WHERE t.id = ?`)
    .bind(period, period, tenantId)
    .first<RawTenantRow>();
  if (!raw) return null;

  const since30 = startOfUtcDay(nowSec) - 29 * DAY_SEC;
  const [meta, users, invitations, drafts, tickets, usageByType] = await Promise.all([
    db
      .prepare(
        `SELECT t.default_locale, t.seo_indexable, t.support_email, t.custom_domain,
                (SELECT d.status FROM tenant_domain d WHERE d.tenant_id = t.id LIMIT 1) AS domain_status
           FROM tenants t WHERE t.id = ?`,
      )
      .bind(tenantId)
      .first<{
        default_locale: string;
        seo_indexable: number;
        support_email: string | null;
        custom_domain: string | null;
        domain_status: string | null;
      }>(),
    db
      .prepare(
        `SELECT u.id, u.email, u.name, u.role, u.email_verified, u.two_factor_enabled, u.banned, u.created_at,
                (SELECT GROUP_CONCAT(a.provider_id) FROM auth_account a
                  WHERE a.tenant_id = u.tenant_id AND a.user_id = u.id) AS providers
           FROM auth_user u WHERE u.tenant_id = ?
          ORDER BY CASE u.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'content' THEN 2 ELSE 3 END,
                   u.created_at ASC`,
      )
      .bind(tenantId)
      .all<{
        id: string;
        email: string;
        name: string | null;
        role: string;
        email_verified: number;
        two_factor_enabled: number;
        banned: number | null;
        created_at: number | null;
        providers: string | null;
      }>(),
    db
      .prepare(
        `SELECT id, email, role, status, expires_at FROM auth_invitation
          WHERE tenant_id = ? AND status = 'pending'
          ORDER BY expires_at ASC`,
      )
      .bind(tenantId)
      .all<{ id: string; email: string; role: string; status: string; expires_at: number }>(),
    db
      .prepare(`SELECT COUNT(*) AS n FROM articles WHERE tenant_id = ? AND status != 'published'`)
      .bind(tenantId)
      .first<{ n: number }>(),
    db
      .prepare(
        `SELECT id, message, status, created_at FROM support_tickets
          WHERE tenant_id = ? ORDER BY created_at DESC LIMIT 5`,
      )
      .bind(tenantId)
      .all<{ id: string; message: string; status: string; created_at: number }>(),
    db
      .prepare(
        `SELECT type, COUNT(*) AS n FROM usage_events
          WHERE tenant_id = ? AND created_at >= ?
            AND type IN ('article_view','ai_generation','ai_translation')
          GROUP BY type`,
      )
      .bind(tenantId, since30)
      .all<{ type: string; n: number }>(),
  ]);

  const usage30 = { views: 0, generations: 0, translations: 0 };
  for (const row of usageByType.results) {
    if (row.type === "article_view") usage30.views = row.n;
    else if (row.type === "ai_generation") usage30.generations = row.n;
    else if (row.type === "ai_translation") usage30.translations = row.n;
  }

  // Tages-Serie über das geteilte Billing-Repo (identische Semantik zum Admin).
  const viewSeries = await new D1BillingRepository(db).getDailyViews(tenantId, {
    days: 30,
    excludeInternal: false,
    nowSec,
  });

  return {
    row: await toTenantRow(db, raw, nowSec),
    defaultLocale: meta?.default_locale ?? "de",
    seoIndexable: meta?.seo_indexable ?? 1,
    supportEmail: meta?.support_email ?? null,
    customDomain: meta?.custom_domain ?? null,
    customDomainStatus: meta?.domain_status ?? null,
    draftArticles: drafts?.n ?? 0,
    users: users.results.map((u) => ({
      id: u.id,
      email: u.email,
      name: u.name,
      role: u.role,
      emailVerified: u.email_verified,
      twoFactorEnabled: u.two_factor_enabled,
      banned: u.banned,
      createdAt: u.created_at,
      providers: (u.providers ?? "").split(",").filter(Boolean).sort(),
    })),
    invitations: invitations.results.map((i) => ({
      id: i.id,
      email: i.email,
      role: i.role,
      status: i.status,
      expiresAt: i.expires_at,
    })),
    viewSeries,
    usage30,
    recentTickets: tickets.results.map((tk) => ({
      id: tk.id,
      message: tk.message,
      status: tk.status,
      createdAt: tk.created_at,
    })),
  };
}
