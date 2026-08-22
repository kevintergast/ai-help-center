import { readPlanState } from "@/server/billing/store";
import { fail, ok, type McpTool } from "./types";

/**
 * AUSWERTUNGS- UND EINSTELLUNGS-LESEWERKZEUGE (Stufe 1).
 *
 * Zweck im Alltag: „Welche Artikel laufen schlecht?" ist die Frage, aus der
 * eine sinnvolle Überarbeitung entsteht — das Modell soll sie beantworten
 * können, bevor es schreibt. Ausgeliefert werden ausschließlich AGGREGATE
 * (Zahlen je Artikel/Zeitfenster), nie einzelne Besucher-Ereignisse.
 */

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true } as const;
const MAX_WINDOW_DAYS = 365;
const DEFAULT_WINDOW_DAYS = 30;

export const getStats: McpTool = {
  name: "get_stats",
  title: "Statistiken lesen",
  description:
    "Read aggregated usage of this help center: total views, daily series, top articles and helpfulness votes. Team members are excluded by default.",
  scope: "analytics:read",
  annotations: READ_ONLY,
  inputSchema: {
    type: "object",
    properties: {
      days: {
        type: "integer",
        minimum: 1,
        maximum: MAX_WINDOW_DAYS,
        description: `Window size in days (default ${DEFAULT_WINDOW_DAYS}).`,
      },
      includeTeam: {
        type: "boolean",
        description: "Include the team's own views (default false).",
      },
    },
  },
  async handler(args, ctx) {
    const billing = await ctx.deps.getBillingDeps?.();
    if (!billing) return fail("analytics_unavailable", "Usage data is not available.");

    const days =
      typeof args.days === "number" && Number.isInteger(args.days) ? args.days : DEFAULT_WINDOW_DAYS;
    if (days < 1 || days > MAX_WINDOW_DAYS) {
      return fail("invalid_params", `\`days\` must be between 1 and ${MAX_WINDOW_DAYS}.`);
    }

    const window = { days, excludeInternal: args.includeTeam !== true, nowSec: ctx.nowSec };
    const [views, daily, top, feedback] = await Promise.all([
      billing.repo.getViewTotal(ctx.tenant.id, window),
      billing.repo.getDailyViews(ctx.tenant.id, window),
      billing.repo.getTopArticles(ctx.tenant.id, window, 10),
      billing.repo.getFeedbackStats(ctx.tenant.id, window),
    ]);

    return ok({
      window: { days, includesTeam: !window.excludeInternal },
      views,
      dailyViews: daily,
      topArticles: top,
      feedback: {
        answers: feedback.answers,
        byArticle: feedback.byArticle,
        note: "Articles with many 'unhelpful' votes are the best candidates for a rewrite.",
      },
    });
  },
};

export const getPlanUsage: McpTool = {
  name: "get_plan_usage",
  title: "Plan & Verbrauch lesen",
  description:
    "Read the current plan, credit usage, monthly active users and limit status of this help center.",
  scope: "analytics:read",
  annotations: READ_ONLY,
  inputSchema: { type: "object", properties: {} },
  async handler(_args, ctx) {
    const billing = await ctx.deps.getBillingDeps?.();
    if (!billing) return fail("analytics_unavailable", "Plan data is not available.");

    const state = await readPlanState(billing.repo, ctx.tenant.id, ctx.nowSec);
    return ok({
      plan: state.plan.id,
      status: state.status,
      includedCredits: state.plan.includedCredits,
      mauLimit: state.plan.mauLimit,
      overCredits: state.overCredits,
      overMau: state.overMau,
      graceDaysLeft: state.graceDaysLeft,
      note:
        state.status === "frozen"
          ? "The plan is frozen: content changes are rejected until the plan is upgraded."
          : undefined,
    });
  },
};

export const getSettings: McpTool = {
  name: "get_settings",
  title: "Einstellungen lesen",
  description:
    "Read branding and help center settings: name, colors, default language, SEO indexing and support address.",
  scope: "settings:read",
  annotations: READ_ONLY,
  inputSchema: { type: "object", properties: {} },
  async handler(_args, ctx) {
    const t = ctx.tenant;
    return ok({
      name: t.name,
      slug: t.slug,
      defaultLocale: t.defaultLocale,
      customDomain: t.customDomain,
      branding: t.branding,
    });
  },
};

export const INSIGHT_TOOLS: McpTool[] = [getStats, getPlanUsage, getSettings];
