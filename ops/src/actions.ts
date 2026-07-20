import { PLAN_ORDER, type PlanId } from "@product/server/billing/pricing";
import type { OpsEnv } from "./access";

/**
 * VERWALTUNGS-AKTIONEN des Ops-Dashboards (Suspend/Plan/Löschen).
 *
 * SELBSTSCHUTZ: `t_operator` (die Betreiber-Instanz selbst) ist von Sperre
 * und Löschung hart ausgenommen — ein Fehlklick darf die Plattform-Instanz
 * nicht töten.
 *
 * LÖSCH-VERIFIZIERUNG (Route + hier): löschen kann man NUR eine bereits
 * BLOCKIERTE Instanz (Zwei-Schritt: erst sperren, dann löschen) — und die
 * Route verlangt zusätzlich den exakt eingetippten Slug. D1 räumt per
 * ON DELETE CASCADE alles Relationale; Vectorize-Vektoren und R2-Objekte
 * werden hier aktiv aufgeräumt (Best-Effort — D1 ist die Wahrheit).
 */

export const PROTECTED_TENANT_ID = "t_operator";

export type ActionResult = "ok" | "not_found" | "protected" | "invalid";

export async function suspendTenant(
  db: D1Database,
  tenantId: string,
  nowSec: number,
): Promise<ActionResult> {
  if (tenantId === PROTECTED_TENANT_ID) return "protected";
  const res = await db
    .prepare(`UPDATE tenants SET suspended_at = ? WHERE id = ? AND suspended_at IS NULL`)
    .bind(nowSec, tenantId)
    .run();
  return res.meta.changes > 0 ? "ok" : "not_found";
}

export async function unsuspendTenant(db: D1Database, tenantId: string): Promise<ActionResult> {
  const res = await db
    .prepare(`UPDATE tenants SET suspended_at = NULL WHERE id = ? AND suspended_at IS NOT NULL`)
    .bind(tenantId)
    .run();
  return res.meta.changes > 0 ? "ok" : "not_found";
}

export interface SetPlanInput {
  tenantId: string;
  plan: PlanId;
  /** Nur bei enterprise wirksam; sonst werden Overrides genullt. */
  customIncludedCredits: number | null;
  customMauLimit: number | null;
}

export function parsePlanForm(form: Record<string, unknown>): SetPlanInput | null {
  const plan = typeof form.plan === "string" ? (form.plan as PlanId) : null;
  if (!plan || !PLAN_ORDER.includes(plan)) return null;

  const num = (v: unknown): number | null => {
    if (typeof v !== "string" || v.trim() === "") return null;
    const n = Number(v);
    return Number.isInteger(n) && n > 0 && n <= 100_000_000 ? n : NaN as never;
  };
  const credits = num(form.customIncludedCredits);
  const mau = num(form.customMauLimit);
  if (Number.isNaN(credits) || Number.isNaN(mau)) return null;

  return {
    tenantId: "",
    plan,
    // Individueller Rahmen ist ein ENTERPRISE-Konzept — Self-Service-Pläne
    // behalten ihre Standard-Limits (pricing.ts), Overrides werden genullt.
    customIncludedCredits: plan === "enterprise" ? credits : null,
    customMauLimit: plan === "enterprise" ? mau : null,
  };
}

export async function setPlan(db: D1Database, input: SetPlanInput): Promise<ActionResult> {
  const tenant = await db
    .prepare(`SELECT id FROM tenants WHERE id = ?`)
    .bind(input.tenantId)
    .first();
  if (!tenant) return "not_found";

  await db
    .prepare(
      `INSERT INTO tenant_plan (tenant_id, plan, custom_included_credits, custom_mau_limit, updated_at)
       VALUES (?, ?, ?, ?, unixepoch())
       ON CONFLICT (tenant_id) DO UPDATE SET
         plan = excluded.plan,
         custom_included_credits = excluded.custom_included_credits,
         custom_mau_limit = excluded.custom_mau_limit,
         updated_at = excluded.updated_at`,
    )
    .bind(input.tenantId, input.plan, input.customIncludedCredits, input.customMauLimit)
    .run();
  return "ok";
}

// ——— NUTZER-AKTIONEN (Instanz-Detail) ————————————————————————————————
// Alle Aktionen sind DOPPELT gescoped (tenant_id UND user_id in jedem WHERE) —
// eine Ops-URL mit fremder Kombination kann nie in einer anderen Instanz
// wirken. Sessions/Trusted-Devices werden bei jedem Reset beendet: der Sinn
// eines Resets ist, dass ALTE Zugänge sofort ungültig sind (kompromittiertes
// Konto, verlorenes Gerät).

async function findTenantUser(
  db: D1Database,
  tenantId: string,
  userId: string,
): Promise<{ id: string; role: string } | null> {
  return db
    .prepare(`SELECT id, role FROM auth_user WHERE id = ? AND tenant_id = ?`)
    .bind(userId, tenantId)
    .first<{ id: string; role: string }>();
}

/** Alle Sessions + Trusted-Devices eines Nutzers beenden (Teil jedes Resets). */
function revokeStatements(db: D1Database, tenantId: string, userId: string) {
  return [
    db
      .prepare(`DELETE FROM auth_session WHERE tenant_id = ? AND user_id = ?`)
      .bind(tenantId, userId),
    db
      .prepare(`DELETE FROM auth_trusted_device WHERE tenant_id = ? AND user_id = ?`)
      .bind(tenantId, userId),
  ];
}

/**
 * ZUGANG ZURÜCKSETZEN: entfernt den Passwort-Login (credential-Account) und
 * beendet alle Sessions. Der Nutzer setzt sich über „Passwort vergessen" auf
 * der Instanz selbst ein neues (Browser-Flow mit Turnstile — deshalb löst Ops
 * die Reset-Mail NICHT server-zu-server aus; better-auth legt beim Reset den
 * credential-Account wieder an, exakt wie beim Ops-erstellten Owner ohne
 * Passwort). Social-Logins (Google) bleiben unberührt.
 * @returns "no_credential" = kein Passwort-Login vorhanden (nur Social) —
 *          Sessions wurden trotzdem beendet.
 */
export async function resetUserPassword(
  db: D1Database,
  tenantId: string,
  userId: string,
): Promise<ActionResult | "no_credential"> {
  const user = await findTenantUser(db, tenantId, userId);
  if (!user) return "not_found";

  const results = await db.batch([
    db
      .prepare(
        `DELETE FROM auth_account WHERE tenant_id = ? AND user_id = ? AND provider_id = 'credential'`,
      )
      .bind(tenantId, userId),
    ...revokeStatements(db, tenantId, userId),
  ]);
  return (results[0]?.meta.changes ?? 0) > 0 ? "ok" : "no_credential";
}

/**
 * MFA ZURÜCKSETZEN (Support-Fall „Authenticator verloren" — bewusst auch für
 * Owner erlaubt): löscht das TOTP-Secret samt Backup-Codes, setzt das Flag
 * zurück und beendet alle Sessions. Beim nächsten Team-Zugriff leitet die
 * Seiten-Gate zur Neu-Einrichtung (/mfa/setup).
 */
export async function resetUserMfa(
  db: D1Database,
  tenantId: string,
  userId: string,
): Promise<ActionResult> {
  const user = await findTenantUser(db, tenantId, userId);
  if (!user) return "not_found";

  await db.batch([
    db
      .prepare(`DELETE FROM auth_two_factor WHERE tenant_id = ? AND user_id = ?`)
      .bind(tenantId, userId),
    db
      .prepare(`UPDATE auth_user SET two_factor_enabled = 0 WHERE id = ? AND tenant_id = ?`)
      .bind(userId, tenantId),
    ...revokeStatements(db, tenantId, userId),
  ]);
  return "ok";
}

/**
 * NUTZER LÖSCHEN. Der OWNER ist hart ausgenommen (jede Instanz braucht genau
 * einen — erst Ownership übertragen, dann löschen). Cascade räumt Sessions/
 * Accounts/TOTP/Trusted-Devices/ausgesprochene Einladungen; `accepted_by`
 * (FK OHNE Cascade) wird genullt, gespeicherte Antworten (kein FK) werden
 * mitgelöscht. `usage_events` bleiben BEWUSST stehen (append-only
 * Abrechnungshistorie; user_id dort ist nur Filter/Debug, kein FK).
 */
export async function deleteUser(
  db: D1Database,
  tenantId: string,
  userId: string,
): Promise<ActionResult> {
  const user = await findTenantUser(db, tenantId, userId);
  if (!user) return "not_found";
  if (user.role === "owner") return "protected";

  await db.batch([
    db
      .prepare(
        `UPDATE auth_invitation SET accepted_by = NULL WHERE tenant_id = ? AND accepted_by = ?`,
      )
      .bind(tenantId, userId),
    db
      .prepare(`DELETE FROM saved_answers WHERE tenant_id = ? AND user_id = ?`)
      .bind(tenantId, userId),
    db.prepare(`DELETE FROM auth_user WHERE id = ? AND tenant_id = ?`).bind(userId, tenantId),
  ]);
  return "ok";
}

/**
 * Instanz endgültig löschen. Voraussetzungen prüft der Aufrufer (Route):
 * Slug-Bestätigung; hier hart erzwungen: geschützt + NUR blockierte Instanzen.
 */
export async function deleteTenant(env: OpsEnv, tenantId: string): Promise<ActionResult> {
  if (tenantId === PROTECTED_TENANT_ID) return "protected";

  const row = await env.DB.prepare(`SELECT suspended_at FROM tenants WHERE id = ?`)
    .bind(tenantId)
    .first<{ suspended_at: number | null }>();
  if (!row) return "not_found";
  if (row.suspended_at === null) return "invalid"; // erst blockieren, dann löschen

  // 1) Such-Vektoren: IDs VOR dem DB-Delete einsammeln, dann in Vectorize
  //    löschen (Batches; Fehler nur loggen — D1-Delete geht trotzdem durch).
  try {
    const chunks = await env.DB.prepare(
      `SELECT vector_id FROM search_chunks WHERE tenant_id = ?`,
    )
      .bind(tenantId)
      .all<{ vector_id: string }>();
    const ids = chunks.results.map((c) => c.vector_id);
    for (let i = 0; i < ids.length; i += 500) {
      await env.VECTORIZE?.deleteByIds(ids.slice(i, i + 500));
    }
  } catch (err) {
    console.error("[ops] Vectorize-Cleanup fehlgeschlagen:", err);
  }

  // 2) R2: alles unter tenants/<id>/ (Logo, Artikel-Bilder), paginiert.
  try {
    if (env.MEDIA) {
      let cursor: string | undefined;
      do {
        const page = await env.MEDIA.list({ prefix: `tenants/${tenantId}/`, cursor });
        if (page.objects.length > 0) {
          await Promise.all(page.objects.map((o) => env.MEDIA!.delete(o.key)));
        }
        cursor = page.truncated ? page.cursor : undefined;
      } while (cursor);
    }
  } catch (err) {
    console.error("[ops] R2-Cleanup fehlgeschlagen:", err);
  }

  // 3) D1: eine Zeile löschen — ON DELETE CASCADE räumt alle Tenant-Daten
  //    (auth_*, articles, usage_*, tickets, saved_answers, domains, …).
  await env.DB.prepare(`DELETE FROM tenants WHERE id = ?`).bind(tenantId).run();
  return "ok";
}
