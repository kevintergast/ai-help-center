import { betterAuth } from "better-auth";
import type { BetterAuthOptions, DBAdapter } from "better-auth";
import { twoFactor } from "better-auth/plugins";
import { canonicalizeEmail } from "./email";
import {
  mfaPolicyBefore,
  mfaSessionCreateBefore,
  mfaStepUpRefreshAfter,
  mfaUserUpdateAfter,
  tenantTwoFactorSchemaPlugin,
} from "./mfa-policy";
import { tenantAwareAdapter } from "./tenant-adapter";

/**
 * Tenant-isolierter better-auth-Aufbau. Phase C: two-factor-Plugin (TOTP +
 * Email-OTP) mit MFA-Policies in der Auth-Pipeline (siehe ./mfa-policy.ts).
 *
 * `tenantId` ist auf JEDEM tenant-gescopeten Modell (user/session/account/
 * verification, twoFactor via tenantTwoFactorSchemaPlugin) als additional Field
 * deklariert. Grund: better-auths Adapter-Factory verwirft in `transformInput`
 * Felder, die nicht im Schema stehen, und `transformWhereClause` schlägt für
 * unbekannte Felder fehl — ohne diese Deklarationen würde die von
 * `tenantAwareAdapter` injizierte/angehängte `tenantId` also stillschweigend
 * verschwinden. `input: false` stellt sicher, dass `tenantId` NIE aus
 * User-Input stammt; gesetzt wird es ausschließlich vom Adapter aus dem
 * Tenant-Kontext.
 *
 * Abweichung 2 vom Soll (dokumentiert): Das Soll setzt user.tenantId auf
 * `required: true`. Das ist auf better-auth-Ebene NICHT erfuellbar:
 * `parseInputData` (db/schema.mjs) wirft fuer ein `required`-Feld, das beim
 * `create` fehlt, ein "tenantId is required" -- und zwar im CORE, BEVOR der
 * Adapter injizieren kann. Da `input: false` gilt, kann der Core den Wert auch
 * nicht selbst liefern. Deshalb ist `tenantId` hier `required: false`. Die
 * Isolation haengt NICHT an diesem Flag, sondern am Adapter
 * (`tenantAwareAdapter`), der als einziger Choke-Point jeden Insert mit
 * `tenantId` versieht und jeden Read/Write auf den Tenant filtert. Ein evtl.
 * `null`-Tenant-Datensatz waere fuer JEDEN Tenant unsichtbar (matcht kein
 * `tenantId == ctx`) -- also fail-closed.
 * TODO(D1): Auf DB-Ebene sollte die Spalte dennoch NOT NULL sein und Teil eines
 * `UNIQUE(tenant_id, email COLLATE NOCASE)` (Defense-in-Depth, unabhaengig vom
 * better-auth-`required`-Flag).
 *
 * Abweichung 1 vom Soll (dokumentiert): Die Aufgabenstellung listet
 * `additionalFields.tenantId` nur für user/session. Für account/verification
 * ist es hier ergänzt, weil diese Modelle laut Soll ebenfalls tenant-gescopet
 * werden — das ist eine sicherheitsverstärkende Ergänzung, keine Abschwächung.
 */

/** Tenant-Diskriminante: nie User-Input, wird vom Adapter aus dem Kontext gesetzt. */
const tenantIdField = {
  type: "string",
  input: false,
  required: false,
  fieldName: "tenant_id",
} as const;

/**
 * HTTP-Mount-Pfad der Auth-Endpunkte (Phase B). better-auths Default-`basePath`
 * ist `/api/auth` (verifiziert in v1.6.23: `dist/auth/base.mjs` →
 * `ctx.options.basePath || "/api/auth"`); da wir unter `/api/v1/auth/*` mounten,
 * MUSS `basePath` hier explizit gesetzt werden, sonst matcht der interne Router
 * keine Route und generierte URLs (Verifikations-/Reset-Links) zeigen ins Leere.
 * Zusammenspiel mit `baseURL`: eine origin-only `baseURL` (wie aus
 * `tenantBaseURL`) wird von better-auth via `withPath()` um genau diesen
 * `basePath` ergänzt — beide Factories (memory + D1) erben ihn über
 * `tenantAuthOptions`, es gibt EINE Quelle.
 */
export const AUTH_BASE_PATH = "/api/v1/auth";

/** Stabiler TOTP-Issuer für Memory-/Test-Instanzen (Runtime: Tenant-Slug). */
export const DEFAULT_TOTP_ISSUER = "hallofhelp-dev";

/** Versand des Email-OTP (2. Faktor, nur content). Runtime: resend.ts-Sender. */
export type SendOtpEmail = (data: {
  user: { email: string; name?: string | null };
  otp: string;
}) => Promise<void>;

export interface TenantAuthOptionsOpts {
  /** TOTP-Issuer (otpauth-URI): Tenant-Slug in der Runtime, stabiler Testwert sonst. */
  issuer?: string;
  /** Email-OTP-Sender; ohne Angabe inert (No-op — wie Resend ohne API-Key). */
  sendOtpEmail?: SendOtpEmail;
}

/**
 * Baut die better-auth-Optionen (ohne `database`). Exportiert, damit Tests /
 * Runtime denselben Options-/Schema-Stand für die Adapter-Instanziierung
 * wiederverwenden können (Schema-Parität zwischen Core und Adapter, kein Drift).
 *
 * PHASE C (two-factor, produktionsreif — Mechanik in mfa-policy.ts verifiziert):
 * - `skipVerificationOnEnable: false`: `/two-factor/enable` legt nur das
 *   Secret an (`twoFactor.verified=false`); `user.twoFactorEnabled` wird ERST
 *   im erfolgreichen `verify-totp`/`verify-otp` geflippt → verlässlicher
 *   „Enrollment abgeschlossen"-Marker (§d).
 * - `otpOptions.sendOTP` ist IMMER konfiguriert (sonst wäre `/two-factor/send-otp`
 *   generell 400 und content könnte kein Email-OTP nutzen); ohne echten Sender
 *   ist der Versand ein No-op (inert, wie resend.ts ohne Key). Für admin/owner
 *   blockt der Pipeline-Hook die OTP-Pfade unabhängig davon (403).
 * - accountLockout: max. 5 Fehlversuche (§d: lockout maxFailedAttempts 5).
 */
export function tenantAuthOptions(
  secret: string,
  opts: TenantAuthOptionsOpts = {},
): BetterAuthOptions {
  const sendOtpEmail: SendOtpEmail = opts.sendOtpEmail ?? (async () => {});
  return {
    secret,
    basePath: AUTH_BASE_PATH,
    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: 10,
    },
    // DB-MAPPING (Design §g, "Better-Auth-Mapping: Kern-Modelle auf auth_*"):
    // die D1-Migrationen (0002/0004) legen auth_*-Tabellen mit snake_case-
    // Spalten an; better-auths Default-Naming wäre `user`/`twoFactor` mit
    // camelCase. Ohne diese `modelName`/`fields`-Mappings liefe JEDE Auth-
    // Operation auf echter D1 ins Leere ("no such table: user") — fail-closed,
    // aber tot. Parität wird von schema-parity.test.ts gegen die Migrationen
    // erzwungen. Das twoFactor-Modell wird analog im
    // tenantTwoFactorSchemaPlugin (mfa-policy.ts) gemappt.
    account: {
      modelName: "auth_account",
      fields: {
        accountId: "account_id",
        providerId: "provider_id",
        userId: "user_id",
        accessToken: "access_token",
        refreshToken: "refresh_token",
        idToken: "id_token",
        accessTokenExpiresAt: "access_token_expires_at",
        refreshTokenExpiresAt: "refresh_token_expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      accountLinking: { enabled: false },
      additionalFields: { tenantId: tenantIdField },
    },
    verification: {
      modelName: "auth_verification",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      additionalFields: { tenantId: tenantIdField },
    },
    user: {
      modelName: "auth_user",
      fields: {
        emailVerified: "email_verified",
        createdAt: "created_at",
        updatedAt: "updated_at",
      },
      additionalFields: {
        tenantId: tenantIdField,
        role: {
          type: ["user", "content", "admin", "owner"],
          input: false,
          defaultValue: "user",
        },
        // M-2: Team-Zielrolle parkt hier, bis das TOTP-Enrollment vollständig
        // ist (Promotion in mfa-policy.ts / mfaUserUpdateAfter). NIE User-Input;
        // gesetzt nur serverseitig (setPendingRole / kommende Invite-Flows).
        pendingRole: {
          type: ["content", "admin"],
          input: false,
          required: false,
          fieldName: "pending_role",
        },
      },
    },
    session: {
      modelName: "auth_session",
      fields: {
        expiresAt: "expires_at",
        createdAt: "created_at",
        updatedAt: "updated_at",
        ipAddress: "ip_address",
        userAgent: "user_agent",
        userId: "user_id",
      },
      additionalFields: {
        tenantId: tenantIdField,
        mfaVerified: {
          type: "boolean",
          input: false,
          defaultValue: false,
          fieldName: "mfa_verified",
        },
        // Step-up-Frische (M-5): Unix-Epoche (Sekunden) des letzten echten
        // Zweitfaktor-Verifys DIESER Session; gesetzt nur in mfa-policy.ts.
        mfaVerifiedAt: {
          type: "number",
          input: false,
          required: false,
          fieldName: "mfa_verified_at",
        },
      },
    },
    plugins: [
      twoFactor({
        issuer: opts.issuer ?? DEFAULT_TOTP_ISSUER,
        skipVerificationOnEnable: false,
        totpOptions: { period: 30 },
        otpOptions: { sendOTP: async ({ user, otp }) => sendOtpEmail({ user, otp }) },
        accountLockout: { enabled: true, maxFailedAttempts: 5 },
      }),
      // NACH twoFactor, damit das tenantId-Feld ins twoFactor-Schema gemerged
      // wird (getAuthTables merged Plugin-Schemata feld-weise in Array-Folge).
      tenantTwoFactorSchemaPlugin,
    ],
    hooks: {
      // MFA-Policies in der PIPELINE (D11): OTP-Verbot für admin/owner,
      // trustDevice-Neutralisierung, Step-up-Gate für disable.
      before: mfaPolicyBefore,
      // Step-up-Refresh: Re-Verify-TOTP in bestehender Session frischt
      // mfaVerified/mfaVerifiedAt auf.
      after: mfaStepUpRefreshAfter,
    },
    databaseHooks: {
      user: {
        create: {
          // E-Mail-Kanonisierung vor dem Store (trim + lowercase + NFC).
          // Hinweis/Limit: better-auths eigener Dublettencheck
          // (`findUserByEmail`) nutzt nur `toLowerCase()`. Diese Kanonisierung
          // ist Defense-in-Depth für den Store; ein vollständig kanonischer
          // Dublettenschutz käme später über einen normalisierten Lookup bzw.
          // UNIQUE(tenant_id, email COLLATE NOCASE) auf DB-Ebene.
          before: async (user) => ({
            data: { ...user, email: canonicalizeEmail(user.email) },
          }),
        },
        update: {
          // pending_role-Promotion (nur nach TOTP-Enrollment) + Session-Revoke
          // bei MFA enable/disable — Details/Verifikation in mfa-policy.ts.
          after: async (user, ctx) => {
            await mfaUserUpdateAfter(
              user as Record<string, unknown> | null,
              ctx as Parameters<typeof mfaUserUpdateAfter>[1],
            );
          },
        },
      },
      session: {
        create: {
          // mfaVerified/mfaVerifiedAt NUR bei Session-Erstellung auf einem
          // echten Verify-Endpunkt (fail-closed) — siehe mfa-policy.ts.
          before: async (session, ctx) =>
            mfaSessionCreateBefore(session as Record<string, unknown>, ctx),
        },
      },
    },
  };
}

/**
 * Baut eine better-auth-Instanz mit tenant-isoliertem Adapter.
 *
 * Abweichung vom Soll (dokumentiert): Das Soll nennt
 * `database: tenantAwareAdapter(adapter)`. In better-auth v1.6.23 akzeptiert
 * `getBaseAdapter` einen bereits fertigen Adapter aber NUR als FUNKTION
 * `(options) => DBAdapter`; ein direkt übergebenes Adapter-OBJEKT liefe in den
 * Kysely-/"direct database"-Pfad und würde fehlschlagen. Deshalb wird der
 * vorgebaute Adapter in eine Funktion gewickelt. Semantik unverändert:
 * `database` ist der tenant-aware-umschlossene Adapter. Sicherheit unberührt.
 */
export function buildAuth({
  adapter,
  secret,
  issuer,
  sendOtpEmail,
}: {
  adapter: DBAdapter;
  secret: string;
  issuer?: string;
  sendOtpEmail?: SendOtpEmail;
}): ReturnType<typeof betterAuth> {
  // Als `BetterAuthOptions` typisiert, damit `betterAuth` den Basis-Typ
  // inferiert (Rückgabe == `ReturnType<typeof betterAuth>` == `Auth<BetterAuthOptions>`;
  // ohne die Annotation würde ein invarianter, engerer `Auth<...>`-Typ inferiert).
  const options: BetterAuthOptions = {
    ...tenantAuthOptions(secret, { issuer, sendOtpEmail }),
    database: () => tenantAwareAdapter(adapter),
  };
  return betterAuth(options);
}
