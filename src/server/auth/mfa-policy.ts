import { APIError } from "better-auth/api";
import { createAuthMiddleware, getSessionFromCtx } from "better-auth/api";
import type { BetterAuthPlugin } from "better-auth";
import { hasAtLeast } from "./access-control";
import { canonicalizeEmail } from "./email";

/**
 * PHASE C — MFA-POLICIES in der AUTH-PIPELINE (Design §d, D11).
 *
 * Alles hier läuft als globaler `options.hooks.before/after`-Hook bzw. als
 * `databaseHooks` DIREKT in better-auths Dispatch-Pipeline — NICHT nur auf
 * eigenen Hono-Routen. Damit sind auch die nativen Plugin-Endpunkte
 * (`/two-factor/*`) gegated (M-1/M-3/M-4), unabhängig von Route-Guards.
 *
 * GEGEN DIE ECHTE PLUGIN-MECHANIK VERIFIZIERT (better-auth v1.6.23,
 * dist/plugins/two-factor/*):
 *  - Endpunkte: /two-factor/enable · /two-factor/disable ·
 *    /two-factor/get-totp-uri · /two-factor/verify-totp · /two-factor/send-otp ·
 *    /two-factor/verify-otp · /two-factor/verify-backup-code ·
 *    /two-factor/generate-backup-codes (+ serverOnly generateTOTP/viewBackupCodes).
 *  - Sign-in-after-Hook des Plugins: bei `user.twoFactorEnabled` wird die vom
 *    Credential-Handler erzeugte Session GELÖSCHT, `newSession` auf null gesetzt
 *    und ein signiertes `two_factor`-Cookie (Verification-Record `2fa-<rand>`,
 *    value = userId) gesetzt → Antwort `{ twoFactorRedirect: true }`. Es gibt
 *    also KEINE nutzbare Session vor dem Zweitfaktor-Verify.
 *  - Session NACH Verify: `verify-two-factor.mjs` → `valid()` →
 *    `internalAdapter.createSession(...)` — läuft durch
 *    `databaseHooks.session.create.before` mit `ctx.path` = Verify-Endpunkt.
 *    GENAU dort (und nur dort) wird `mfaVerified`/`mfaVerifiedAt` gesetzt.
 *  - trustDevice: `ctx.body.trustDevice` bei den Verify-Endpunkten erzeugt ein
 *    `trust_device`-Cookie (HMAC über `${userId}!${trustIdentifier}`) + einen
 *    Verification-Record; der Sign-in-after-Hook überspringt damit den
 *    Zweitfaktor (Session bleibt bestehen). Neutralisierung für Team-Rollen:
 *    (1) `trustDevice` wird serverseitig aus dem Body gestrichen (Cookie
 *    entsteht nie), (2) beim Sign-in eines Team-Users wird ein evtl. vorhandener
 *    Trust-Record serverseitig gelöscht → der Skip validiert nicht mehr.
 *    Wichtig: selbst ein erfolgreicher Skip erzeugte nur eine Session mit
 *    `mfaVerified=false` (Marker entsteht NUR auf Verify-Pfaden) — Defense-in-Depth.
 */

/** Cookie-Namen des two-factor-Plugins (verifiziert: dist/plugins/two-factor/constant.mjs). */
const TWO_FACTOR_COOKIE_NAME = "two_factor";
const TRUST_DEVICE_COOKIE_NAME = "trust_device";

/** Verify-Endpunkte = die einzigen Orte, an denen ein 2. Faktor bewiesen wird. */
const SECOND_FACTOR_VERIFY_PATHS: ReadonlySet<string> = new Set([
  "/two-factor/verify-totp",
  "/two-factor/verify-otp",
  "/two-factor/verify-backup-code",
]);

/** Email-OTP-/Backup-Code-Pfade: für admin/owner als 2. Faktor verboten (§d, M-4). */
const OTP_LIKE_PATHS: ReadonlySet<string> = new Set([
  "/two-factor/send-otp",
  "/two-factor/verify-otp",
  "/two-factor/verify-backup-code",
]);

/** Maximales Alter (Sekunden) eines TOTP-Verifys für Step-up-Aktionen (M-5). */
export const STEP_UP_MAX_AGE_SEC = 300;

/** Unix-Epoche in Sekunden (Schema: session.mfaVerifiedAt als number/unixepoch). */
function nowEpochSec(): number {
  return Math.floor(Date.now() / 1000);
}

interface RoleCarrier {
  role?: string | null;
  pendingRole?: string | null;
}

/**
 * „TOTP-only"-Stufe: admin/owner — auch als GEPARKTE Zielrolle (`pendingRole`),
 * damit ein designierter Admin sein Enrollment nicht per Email-OTP auf einen
 * schwächeren Faktor umbiegen kann, bevor die Rolle aktiv wird.
 */
function isTotpOnly(user: RoleCarrier): boolean {
  return hasAtLeast(user.role, "admin") || hasAtLeast(user.pendingRole ?? undefined, "admin");
}

/** Team-Stufe (content/admin/owner, aktiv ODER geparkt): trustDevice hart aus (M-3). */
function isTeam(user: RoleCarrier): boolean {
  return hasAtLeast(user.role, "content") || hasAtLeast(user.pendingRole ?? undefined, "content");
}

type AnyCtx = Parameters<Parameters<typeof createAuthMiddleware>[0]>[0];

/**
 * Ermittelt den HANDELNDEN User eines /two-factor/*-Requests:
 * 1. echte Session (Enable/Disable/Step-up-Flows), sonst
 * 2. das signierte `two_factor`-Cookie des laufenden Logins (Verification-
 *    Record value = userId; exakt die Mechanik von `verifyTwoFactor()`).
 * `null` = nicht zuordenbar → der Endpunkt lehnt selbst ab (401).
 */
async function resolveActingUser(ctx: AnyCtx): Promise<RoleCarrier | null> {
  const session = await getSessionFromCtx(ctx).catch(() => null);
  if (session?.user) return session.user as RoleCarrier;

  const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME);
  const identifier = await ctx
    .getSignedCookie(cookie.name, ctx.context.secret)
    .catch(() => null);
  if (!identifier) return null;
  const record = await ctx.context.internalAdapter
    .findVerificationValue(identifier)
    .catch(() => null);
  if (!record) return null;
  return (await ctx.context.internalAdapter
    .findUserById(record.value)
    .catch(() => null)) as RoleCarrier | null;
}

/**
 * GLOBALER before-Hook (options.hooks.before) — läuft VOR jedem Endpunkt.
 *
 * (a) Email-OTP/Backup-Code als 2. Faktor für admin/owner ablehnen (403,
 *     stabiler Code `otp_not_allowed_for_role`) — content bleibt erlaubt (§d).
 * (b) `trustDevice` für Team-Rollen serverseitig neutralisieren (Body-Override
 *     auf `false` → das Plugin legt weder Cookie noch Trust-Record an) und beim
 *     Sign-in vorhandene Trust-Records eines Team-Users löschen (kein
 *     30-Tage-Bypass, M-3).
 * (c) 2FA-DISABLE für Team-Rollen nur mit FRISCHEM Step-up (`mfaVerifiedAt`
 *     jünger als STEP_UP_MAX_AGE_SEC), sonst 403 `mfa_stepup_required` (§d/M-5).
 *
 * Fail-closed: ist der User auf einem OTP-Pfad nicht zuordenbar, obwohl ein
 * 2FA-Kontext existiert, entscheidet der Endpunkt (401); wirft die Zuordnung
 * einen FEHLER, wird abgelehnt statt durchgelassen.
 */
export const mfaPolicyBefore = createAuthMiddleware(async (ctx) => {
  const path = ctx.path ?? "";

  // Sign-in: Trust-Device-Skip für Team-User serverseitig entwerten (M-3).
  if (path === "/sign-in/email") {
    const email = typeof ctx.body?.email === "string" ? canonicalizeEmail(ctx.body.email) : null;
    if (!email) return;
    // findUserByEmail liefert `{ user, accounts } | null` (verifiziert:
    // dist/db/internal-adapter.mjs) — tenant-scoped durch den Adapter-Wrapper.
    const found = await ctx.context.internalAdapter.findUserByEmail(email).catch(() => null);
    const roleUser = (found?.user ?? null) as RoleCarrier | null;
    if (!roleUser || !isTeam(roleUser)) return;

    const trustCookie = ctx.context.createAuthCookie(TRUST_DEVICE_COOKIE_NAME);
    const value = await ctx
      .getSignedCookie(trustCookie.name, ctx.context.secret)
      .catch(() => null);
    if (!value) return;
    const [, trustIdentifier] = value.split("!");
    if (trustIdentifier) {
      // Serverseitigen Trust-Record löschen → der Plugin-Skip validiert nicht
      // mehr und der reguläre 2FA-Challenge-Pfad greift.
      await ctx.context.internalAdapter
        .deleteVerificationByIdentifier(trustIdentifier)
        .catch(() => {});
    }
    return;
  }

  if (!path.startsWith("/two-factor/")) return;

  let user: RoleCarrier | null;
  try {
    user = await resolveActingUser(ctx);
  } catch {
    // Fail-closed: Policy-Subjekt nicht bestimmbar → sicherheitsrelevante
    // Zweitfaktor-Pfade ablehnen statt ungeprüft durchlassen.
    if (OTP_LIKE_PATHS.has(path)) {
      throw new APIError("FORBIDDEN", { message: "Policy check failed", code: "mfa_policy_unavailable" });
    }
    user = null;
  }
  if (!user) return; // Endpunkt behandelt „kein Kontext" selbst (401).

  // (a) admin/owner: nur TOTP als 2. Faktor — Email-OTP & Backup-Codes 403.
  if (OTP_LIKE_PATHS.has(path) && isTotpOnly(user)) {
    throw new APIError("FORBIDDEN", {
      message: "Email OTP and backup codes are not allowed as a second factor for this role",
      code: "otp_not_allowed_for_role",
    });
  }

  // (b) trustDevice für Team-Rollen serverseitig neutralisieren.
  if (SECOND_FACTOR_VERIFY_PATHS.has(path) && isTeam(user) && ctx.body?.trustDevice) {
    return {
      context: { body: { ...ctx.body, trustDevice: false } },
    };
  }

  // (c) Disable nur mit frischem Step-up für Team-Rollen (§d, M-5).
  if (path === "/two-factor/disable" && isTeam(user)) {
    const session = await getSessionFromCtx(ctx).catch(() => null);
    const s = session?.session as
      | { mfaVerified?: boolean | null; mfaVerifiedAt?: number | null }
      | undefined;
    const fresh =
      !!s?.mfaVerified &&
      typeof s.mfaVerifiedAt === "number" &&
      nowEpochSec() - s.mfaVerifiedAt <= STEP_UP_MAX_AGE_SEC;
    if (!fresh) {
      throw new APIError("FORBIDDEN", {
        message: "A fresh second-factor verification is required to disable MFA",
        code: "mfa_stepup_required",
      });
    }
  }
});

/**
 * GLOBALER after-Hook (options.hooks.after): Step-up-Refresh.
 *
 * `verifyTOTP` MIT bestehender Session (Re-Verify) erstellt KEINE neue Session
 * — die Antwort trägt den Token der BESTEHENDEN Session (verifiziert:
 * verify-two-factor.mjs, Session-Zweig von `valid()`). Genau dann wird
 * `mfaVerified/mfaVerifiedAt` der Session aufgefrischt (Step-up-Frische für
 * spätere Owner-Aktionen, M-5). Rotierte/neue Sessions (Token ≠ Session-Token)
 * bekommen den Marker bereits über `mfaSessionCreateBefore`.
 */
export const mfaStepUpRefreshAfter = createAuthMiddleware(async (ctx) => {
  if (ctx.path !== "/two-factor/verify-totp") return;
  const session = ctx.context.session;
  const returned = ctx.context.returned as { token?: unknown } | undefined;
  if (!session?.session?.token || !returned || typeof returned !== "object") return;
  if (returned.token !== session.session.token) return;
  await ctx.context.internalAdapter.updateSession(session.session.token, {
    mfaVerified: true,
    mfaVerifiedAt: nowEpochSec(),
  });
});

/**
 * `databaseHooks.session.create.before`: Session-Marker (Aufgabe 2).
 *
 * `mfaVerified=true` + `mfaVerifiedAt=unixepoch` werden AUSSCHLIESSLICH gesetzt,
 * wenn die Session auf einem Verify-Endpunkt entsteht (echtes Zweitfaktor-Event
 * dieser Session). Jede andere Session — Sign-in, Sign-up, Trusted-Device-Skip,
 * Rotation bei disable — bleibt explizit `mfaVerified=false` (fail-closed;
 * kein `ctx`/unbekannter Pfad zählt als „kein Verify").
 */
export function mfaSessionCreateBefore(
  session: Record<string, unknown>,
  ctx: { path?: string } | null | undefined,
): { data: Record<string, unknown> } {
  const verified = SECOND_FACTOR_VERIFY_PATHS.has(ctx?.path ?? "");
  return {
    data: {
      ...session,
      mfaVerified: verified,
      mfaVerifiedAt: verified ? nowEpochSec() : null,
    },
  };
}

/** Adapter-Ausschnitt, den der user.update-Hook benötigt (tenant-scoped!). */
interface HookAdapter {
  update(args: {
    model: string;
    where: Array<{ field: string; value: unknown; operator?: string }>;
    update: Record<string, unknown>;
  }): Promise<unknown>;
  deleteMany(args: {
    model: string;
    where: Array<{ field: string; value: unknown; operator?: string }>;
  }): Promise<number>;
}

interface UpdateHookCtx {
  path?: string;
  context?: {
    adapter?: HookAdapter;
    newSession?: { session?: { token?: string } } | null;
  };
}

/**
 * `databaseHooks.user.update.after`: pending_role-Promotion + Session-Revoke.
 *
 * Verifizierte Plugin-Mechanik: `twoFactorEnabled` wird per
 * `internalAdapter.updateUser` NUR geflippt bei
 *  - Enrollment-Abschluss (verify-totp/verify-otp mit Session, `→ true`),
 *  - `/two-factor/disable` (`→ false`),
 *  - `/two-factor/enable` nur bei `skipVerificationOnEnable:true` (hier false).
 *
 * (1) PROMOTION (M-2, Aufgabe 3): NUR nach echtem TOTP-Enrollment
 *     (`/two-factor/verify-totp` + `twoFactorEnabled→true`) wird
 *     `role = pending_role` gesetzt und `pending_role` geleert — als EIN
 *     Adapter-Update (eine UPDATE-Anweisung, Bedingungen im WHERE → atomar,
 *     tenant-scoped durch den tenantAwareAdapter). Email-OTP-Enrollment
 *     (`/two-factor/verify-otp`) promotet bewusst NICHT: §d verlangt
 *     vollständiges TOTP-Enrollment für Team-Rollen.
 *
 * (2) REVOKE (§e, Aufgabe 6): bei Enrollment-Abschluss UND bei Disable werden
 *     alle ANDEREN Sessions des Users widerrufen. Die frisch rotierte Session
 *     (`ctx.context.newSession`, vom Plugin via setSessionCookie gesetzt) bleibt
 *     erhalten; ist (noch) keine bekannt — z. B. weil der Hook vor der
 *     Session-Rotation läuft — werden ALLE widerrufen (fail-closed: der User
 *     muss sich neu anmelden, nie umgekehrt).
 */
export async function mfaUserUpdateAfter(
  user: Record<string, unknown> | null,
  ctx: UpdateHookCtx | null | undefined,
): Promise<void> {
  const path = ctx?.path;
  const adapter = ctx?.context?.adapter;
  if (!user || !path || !adapter) return;
  const userId = user.id;
  if (typeof userId !== "string") return;

  const enrolled =
    (path === "/two-factor/verify-totp" || path === "/two-factor/verify-otp") &&
    user.twoFactorEnabled === true;
  const disabled = path === "/two-factor/disable" && user.twoFactorEnabled === false;

  // (1) Promotion — NUR TOTP-Enrollment, NUR wenn pending_role gesetzt.
  const pendingRole = user.pendingRole;
  if (
    path === "/two-factor/verify-totp" &&
    user.twoFactorEnabled === true &&
    (pendingRole === "content" || pendingRole === "admin")
  ) {
    await adapter.update({
      model: "user",
      where: [
        { field: "id", value: userId },
        // Bedingung im WHERE statt vorab gelesen → kein TOCTOU:
        { field: "twoFactorEnabled", value: true },
        { field: "pendingRole", value: pendingRole },
      ],
      update: { role: pendingRole, pendingRole: null },
    });
  }

  // (2) Revoke anderer Sessions bei MFA enable/disable.
  if (enrolled || disabled) {
    const keepToken = ctx?.context?.newSession?.session?.token;
    await adapter.deleteMany({
      model: "session",
      where: [
        { field: "userId", value: userId },
        ...(typeof keepToken === "string"
          ? [{ field: "token", value: keepToken, operator: "ne" }]
          : []),
      ],
    });
  }
}

/**
 * Lokales Schema-Plugin: deklariert `tenantId` als Feld des `twoFactor`-Modells
 * UND mappt das Plugin-Schema auf die D1-Migrationen (auth_two_factor,
 * snake_case — Design §g "Better-Auth-Mapping").
 *
 * Ohne die tenantId-Deklaration würde better-auths Adapter-Factory das vom
 * `tenantAwareAdapter` injizierte `tenantId` in `transformInput` VERWERFEN und
 * `transformWhereClause` würde für die angehängte Tenant-Bedingung fehlschlagen
 * — exakt die Mechanik, die in `auth.ts` für user/session/account/verification
 * dokumentiert ist. Plugin-Schemata werden in `getAuthTables` feld-weise
 * gemerged (verifiziert: @better-auth/core dist/db/get-tables.mjs), d. h. dieses
 * Plugin ERGÄNZT das twoFactor-Schema des offiziellen Plugins.
 *
 * MAPPING-MECHANIK (verifiziert: get-tables.mjs): `modelName: value.modelName
 * || key` — der LETZTE Plugin-Eintrag je Modell bestimmt den modelName; dieses
 * Plugin steht in `auth.ts` bewusst NACH dem twoFactor-Plugin. Die Feld-Merges
 * ersetzen je Feld die GESAMTE Definition, deshalb sind die umbenannten Felder
 * hier VOLLSTÄNDIG (inkl. type/required/returned/references) aus
 * dist/plugins/two-factor/schema.mjs übernommen — nur um `fieldName` ergänzt.
 * `secret` und `verified` heißen in der Migration gleich und bleiben beim
 * Original; `references.model` bleibt der LOGISCHE Modellname ("user"), da
 * better-auth ihn über `getDefaultModelName` auflöst (factory.mjs,
 * transformJoinClause). `user.twoFactorEnabled` (vom Plugin als user-Feld
 * beigesteuert) wird hier ebenfalls auf die Migrations-Spalte gemappt.
 */
export const tenantTwoFactorSchemaPlugin = {
  id: "hallofhelp-tenant-two-factor",
  schema: {
    user: {
      fields: {
        twoFactorEnabled: {
          type: "boolean",
          required: false,
          defaultValue: false,
          input: false,
          fieldName: "two_factor_enabled",
        },
      },
    },
    twoFactor: {
      modelName: "auth_two_factor",
      fields: {
        backupCodes: {
          type: "string",
          required: true,
          returned: false,
          fieldName: "backup_codes",
        },
        userId: {
          type: "string",
          required: true,
          returned: false,
          references: { model: "user", field: "id" },
          index: true,
          fieldName: "user_id",
        },
        failedVerificationCount: {
          type: "number",
          required: false,
          defaultValue: 0,
          input: false,
          returned: false,
          fieldName: "failed_verification_count",
        },
        lockedUntil: {
          type: "date",
          required: false,
          input: false,
          returned: false,
          fieldName: "locked_until",
        },
        tenantId: { type: "string", required: false, input: false, fieldName: "tenant_id" },
      },
    },
  },
} satisfies BetterAuthPlugin;
