import type { Context } from "hono";
import { Hono } from "hono";
import { requireTeam } from "@/server/auth/guards";
import { generateApiKey, hashApiKey } from "@/server/apikeys/keys";
import {
  isApiScope,
  isBroadAccess,
  parseScopes,
  riskLevel,
  scopesNeedingAcknowledgement,
  type ApiScope,
} from "@/server/apikeys/scopes";
import type { ApiDeps, ApiEnv, GuardSessionData } from "./context";

/**
 * VERWALTUNG DER ZUGRIFFS-SCHLÜSSEL (`/admin/api-keys`).
 *
 *   - GET    /admin/api-keys       — Liste (nie Klartext, nur Präfix + Rechte)
 *   - POST   /admin/api-keys       — anlegen; liefert den Klartext GENAU EINMAL
 *   - DELETE /admin/api-keys/:id   — widerrufen (sofort wirksam)
 *
 * GATING: `requireTeam("admin")` — ein Schlüssel entsteht also nur aus einer
 * MFA-verifizierten Admin-/Owner-Session. Das ist die Begründung dafür, dass
 * der Schlüssel selbst später ohne MFA arbeiten darf (docs/mcp-plan.md §4 E4).
 *
 * WARNUNGEN SIND NICHT NUR UI: Rote (zerstörende) Scopes verlangen im Body ein
 * ausdrückliches `acknowledgedScopes` je Scope. Die Checkbox im Admin ist die
 * Anzeige dieser Regel — die Regel selbst steht hier. Eine UI-Checkbox allein
 * wäre keine Kontrolle (jeder kann den Request von Hand schicken).
 */

const MAX_NAME_LENGTH = 80;
/** Genug für getrennte Schlüssel je Werkzeug/Person, wenig genug als Wildwuchs-Bremse. */
const MAX_ACTIVE_KEYS = 20;
const DEFAULT_EXPIRY_DAYS = 90;
const MAX_EXPIRY_DAYS = 365;
const DAY_SEC = 86_400;

async function readJson(c: Context<ApiEnv>): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await c.req.json() };
  } catch {
    return { ok: false };
  }
}

/** Aktuelle User-ID (Ersteller) — best effort, blockiert nie. */
async function actorId(c: Context<ApiEnv>): Promise<string | null> {
  try {
    const auth = await c.get("getAuth")();
    const data = (await auth.api.getSession({
      headers: c.req.raw.headers,
    })) as (GuardSessionData & { user?: { id?: string } }) | null;
    return data?.user?.id ?? null;
  } catch {
    return null;
  }
}

interface KeyView {
  id: string;
  name: string;
  keyPrefix: string;
  scopes: ApiScope[];
  risk: ReturnType<typeof riskLevel>;
  broadAccess: boolean;
  createdAt: number;
  expiresAt: number;
  lastUsedAt: number | null;
  revokedAt: number | null;
  status: "active" | "revoked" | "expired";
}

export function apiKeysAdminRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  r.get("/", requireTeam("admin"), async (c) => {
    const keyDeps = await deps.getApiKeyDeps?.();
    if (!keyDeps) return c.json({ error: "api_keys_unavailable" }, 503);

    const nowSec = Math.floor(Date.now() / 1000);
    const keys: KeyView[] = (await keyDeps.repo.listByTenant(c.get("tenant").id)).map((k) => ({
      id: k.id,
      name: k.name,
      keyPrefix: k.keyPrefix,
      scopes: k.scopes,
      risk: riskLevel(k.scopes),
      broadAccess: isBroadAccess(k.scopes),
      createdAt: k.createdAt,
      expiresAt: k.expiresAt,
      lastUsedAt: k.lastUsedAt,
      revokedAt: k.revokedAt,
      status: k.revokedAt !== null ? "revoked" : k.expiresAt <= nowSec ? "expired" : "active",
    }));
    return c.json({ keys });
  });

  r.post("/", requireTeam("admin"), async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: "invalid_json" }, 400);
    const body = (parsed.body ?? {}) as Record<string, unknown>;

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length === 0 || name.length > MAX_NAME_LENGTH) {
      return c.json({ error: "invalid_name" }, 400);
    }

    const scopes = parseScopes(body.scopes);
    if (!scopes) return c.json({ error: "invalid_scopes" }, 400);

    // Zerstörende Scopes: je Scope eine ausdrückliche Bestätigung im Body.
    const acknowledged = Array.isArray(body.acknowledgedScopes)
      ? body.acknowledgedScopes.filter(isApiScope)
      : [];
    const missing = scopesNeedingAcknowledgement(scopes).filter((s) => !acknowledged.includes(s));
    if (missing.length > 0) {
      return c.json({ error: "acknowledgement_required", scopes: missing }, 400);
    }

    // Ablauf: Pflicht. Unbefristete Schlüssel gibt es bewusst nicht.
    const rawDays = body.expiresInDays;
    const days = rawDays === undefined ? DEFAULT_EXPIRY_DAYS : rawDays;
    if (typeof days !== "number" || !Number.isInteger(days) || days < 1 || days > MAX_EXPIRY_DAYS) {
      return c.json({ error: "invalid_expiry" }, 400);
    }

    const keyDeps = await deps.getApiKeyDeps?.();
    if (!keyDeps) return c.json({ error: "api_keys_unavailable" }, 503);

    const tenantId = c.get("tenant").id;
    const nowSec = Math.floor(Date.now() / 1000);
    const existing = await keyDeps.repo.listByTenant(tenantId);
    const active = existing.filter((k) => k.revokedAt === null && k.expiresAt > nowSec);
    if (active.length >= MAX_ACTIVE_KEYS) return c.json({ error: "too_many_keys" }, 400);

    const { token, prefix } = generateApiKey();
    const id = crypto.randomUUID();
    const expiresAt = nowSec + days * DAY_SEC;

    await keyDeps.repo.create({
      id,
      tenantId,
      name,
      keyHash: await hashApiKey(token),
      keyPrefix: prefix,
      scopes,
      createdBy: await actorId(c),
      createdAt: nowSec,
      expiresAt,
    });

    await audit(c, deps, "api_key.created", id, { name, scopes, expiresAt });

    // `token` ist das einzige Mal, dass der Klartext existiert — die UI zeigt
    // ihn genau hier und nie wieder (er ist nirgends rekonstruierbar).
    return c.json(
      {
        ok: true,
        id,
        token,
        keyPrefix: prefix,
        scopes,
        risk: riskLevel(scopes),
        broadAccess: isBroadAccess(scopes),
        expiresAt,
      },
      201,
    );
  });

  r.delete("/:id", requireTeam("admin"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "not_found" }, 404);

    const keyDeps = await deps.getApiKeyDeps?.();
    if (!keyDeps) return c.json({ error: "api_keys_unavailable" }, 503);

    const revoked = await keyDeps.repo.revoke(c.get("tenant").id, id, Math.floor(Date.now() / 1000));
    if (!revoked) return c.json({ error: "not_found" }, 404);

    await audit(c, deps, "api_key.revoked", id, null);
    return c.json({ ok: true });
  });

  return r;
}

/**
 * Audit-Eintrag — non-blocking (Muster team.ts): ein Ausfall des Logs darf die
 * fachliche Aktion nicht kippen. METADATA-DISZIPLIN: nie der Schlüssel selbst,
 * nur Name/Scopes/Ablauf.
 */
async function audit(
  c: Context<ApiEnv>,
  deps: ApiDeps,
  action: "api_key.created" | "api_key.revoked",
  targetId: string,
  metadata: Record<string, unknown> | null,
): Promise<void> {
  try {
    const team = await deps.getTeamDeps();
    await team?.audit.append({
      tenantId: c.get("tenant").id,
      actorId: await actorId(c),
      action,
      targetId,
      ipAddress: c.req.header("cf-connecting-ip") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
      metadata,
    });
  } catch (err) {
    console.error("[api-keys] Audit fehlgeschlagen (ignoriert):", err);
  }
}
