# HallofHelp — Auth-Architektur (Better Auth, gehärtet, strikt instanz-isoliert)

> **Status:** Finale, sicherheits-gehärtete Version. Alle validen Angriffs-Findings (Tenant-Isolation, Privilege-Escalation, Account-Linking/Identity-Bleed, MFA-Bypass) sind eingearbeitet.
>
> **Leitprinzip der Härtung:** **Fail-closed statt fail-open**, **default-deny statt opt-in**, **kryptografische Tenant-Bindung statt nur relationaler**, **serverseitiges Enforcement in der Auth-Pipeline statt nur auf eigenen Routen**.
>
> Betroffene/anzulegende Pfade:
> - `migrations/0002_auth.sql` (Schema, forward-only)
> - `migrations/0003_deseed_prod.sql` (Entfernung Demo-Seed für Prod, forward-only)
> - `src/server/tenant/resolve-tenant.ts` (→ `resolveTenantStrict`, fail-closed)
> - `src/server/db/client.ts` (→ `getDbOrThrow`, kein Silent-null im Request)
> - `src/server/auth/auth.ts` (Factory `createAuth(env, tenant)`)
> - `src/server/auth/tenant-context.ts` (**eine** Tenant-Quelle: ALS am äußersten Boundary)
> - `src/server/auth/tenant-adapter.ts` (default-deny Wrapper, fail-closed scope)
> - `src/server/auth/secondary-storage.ts` (tenant-präfigierter KV-Store)
> - `src/server/auth/crypto.ts` (HKDF-Ableitung per-Tenant-Signierschlüssel)
> - `src/server/auth/access-control.ts`, `guards.ts`, `invitations.ts`, `hooks.ts`, `oauth-gateway.ts`

---

## 0. Grundsatzentscheidungen (gehärtet)

| # | Entscheidung | Begründung |
|---|---|---|
| D1 | **Kein `organization`-Plugin.** Tenant-Grenze über `tenant_id` auf jeder Auth-Tabelle. | Org-Plugin = geteilte globale Identität; verletzt Instanz-Isolation. |
| D2 | **`admin`-Plugin** nur als `role`-Feldträger. **`adminRoles` NICHT gesetzt** (leer). Alle mutierenden Plugin-Endpunkte serverseitig deaktiviert/überschrieben. | admin-Plugin autorisiert seine nativen Endpunkte selbst über `adminRoles` und umgeht damit unsere Guards → siehe H-P1. |
| D3 | Eigener, tenant-scoped Invitation-Flow (`auth_invitation`); Rollen-Deckel bei **CREATE und ACCEPT**. | Token-Besitz darf nie eine Rolle unter fremder Identität vergeben (H-A5). |
| D4 | `drizzleAdapter(db,{provider:'sqlite',transaction:false})` + **default-deny** tenant-aware Wrapper. DDL handgeschrieben, forward-only. | D1 hat keine interaktiven Transaktionen; composite-UNIQUE nur via eigenes DDL. |
| D5 | `tenant_id`, `role`, `pending_role`, `mfaVerified` als `additionalFields` mit `input:false`; serverseitig gesetzt. | Verhindert Tenant-Spoofing / Privilege-Escalation beim Signup. |
| D6 | **Genau EINE Tenant-Quelle:** Tenant wird am äußersten, für Hono UND Next gemeinsamen Request-Boundary in eine `AsyncLocalStorage` gesetzt und als `tenant` an `createAuth(env, tenant)` gebunden. Adapter liest **denselben** Wert; `assert(als.tenantId === factory.tenantId)`. | Doppelte Quellen (ALS vs. Factory-Arg) divergieren sonst → Cross-Tenant (T-6, A-1). |
| D7 | **Fail-closed Tenant-Auflösung.** `resolveTenantStrict(host)` → `Tenant | null`; **kein** Default-/Demo-Fallback. `null` ⇒ 404/421, Auth-Instanz wird gar nicht gebaut. `getDbSafe()===null` im Worker-Request ⇒ 503 (kein Registry-Fallback; Registry nur in Tests via injizierter Fake-Source). | Fail-open kollabiert reale Tenants auf `t_demo` (T-1, T-3, A-2). |
| D8 | **Kryptografische Tenant-Bindung:** Cookie-/State-Signaturen mit `HKDF(env.AUTH_SECRET, tenantId)` je Instanz. Ein instanzfremdes Cookie scheitert bereits an der Signaturprüfung. | Gemeinsames Secret macht A-Artefakte unter B gültig (T-5). |
| D9 | **`cookieCache` global AUS** (`session.cookieCache.enabled:false`), nicht nur im Guard. **Nie** Parent-Domain-Cookie (`Domain=.hallofhelp.com`); host-scoped Cookies pro Origin, kein `crossSubDomainCookies`. | Verzögerte Widerrufe + Browser teilt A-Cookies an B (T-5, D9-alt). |
| D10 | **`secondaryStorage` mit tenant-präfigierten Keys** (`${tenantId}:...`) für Session, Rate-Limit, OTP/Verification. Session-Tenant-Bindung zusätzlich in zentralem Hook. | Geteilter KV umgeht Adapter-Scope: Cross-Tenant-Session, Rate-Limit-Griefing, OTP-Kollision (T-2, T-7). |
| D11 | **MFA-Gate + Rollen-/Step-up-Enforcement in der Auth-Pipeline** (globaler `before`-Hook, `createAuthMiddleware`), nicht nur in `requireTeam`. | Native Plugin-Endpunkte (`/admin/*`, `/two-factor/*`) laufen an Route-Guards vorbei (M-1, P-1). |
| D12 | **Default-deny auf `/api/v1`:** jede Route braucht authentifizierte, tenant-gebundene, rollen-geprüfte Session; öffentliche Routen über explizite `.public()`-Allowlist. Build-Test enumeriert Routen. | Eine vergessene Guard = Zugriff ohne MFA/Rolle (P-3). |

### Config-Skelett (`src/server/auth/auth.ts`)

```ts
export function createAuth(env: CloudflareEnv, tenant: Tenant) {
  // D6: gebundener Tenant; Adapter/Hook prüfen Konsistenz gegen ALS.
  const tenantId = tenant.id;
  const perTenantSecret = hkdf(env.AUTH_SECRET, tenantId);          // D8
  return betterAuth({
    secret: perTenantSecret,                                        // D8: kryptografische Isolation
    database: tenantAwareAdapter(
      drizzleAdapter(drizzle(env.DB), { provider: "sqlite", transaction: false }),
      tenantId,                                                     // D4 + D6
    ),
    secondaryStorage: tenantScopedKv(env.AUTH_KV, tenantId),        // D10: keys ${tenantId}:...
    session: {
      expiresIn: 60*60*24*7, updateAge: 60*60*24, freshAge: 60*15,
      storeSessionInDatabase: true,                                 // D10: Session auch über Adapter scopebar
      cookieCache: { enabled: false },                              // D9: global aus
      additionalFields: {
        tenantId:      { type:"string",  input:false },
        mfaVerified:   { type:"boolean", input:false, defaultValue:false },
        mfaVerifiedAt: { type:"number",  input:false },             // Step-up-Frische (M-5)
      },
    },
    emailAndPassword: { enabled: true, requireEmailVerification: true,
      revokeSessionsOnPasswordReset: true, sendResetPassword, minPasswordLength: 10,
      password: { hash: argon2idWasm, verify: argon2idVerify } },   // Workers-CPU-tauglich
    account: { accountLinking: { enabled: false } },                // A-4/T-4: voll aus
    user: { additionalFields: {
      tenantId:    { type:"string", input:false, required:true },
      role:        { type:["user","content","admin","owner"], input:false, defaultValue:"user" },
      pendingRole: { type:["content","admin"], input:false },       // M-2: Rolle vor MFA parken
    } },
    rateLimit: { enabled: true, storage: "secondary-storage",       // Keys tenant-präfigiert via D10
      customRules: { "/sign-in/email":{window:60,max:5},
        "/two-factor/*":{window:60,max:5},
        "/request-password-reset":{window:60,max:3},
        "/invite/accept":{window:60,max:10} } },
    advanced: {
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      useSecureCookies: true,
      crossSubDomainCookies: { enabled: false },                    // D9: nie Parent-Domain
    },
    trustedOrigins: async () => await allowedOriginsFor(tenant),    // exakt, pro Tenant/Custom-Domain
    plugins: [ twoFactor({ /* §d */ }),
               admin({ ac, roles, defaultRole:"user" /* KEIN adminRoles */ }),
               nextCookies() ],                                     // MUSS zuletzt
    databaseHooks, hooks,                                           // §c/§d/§e/§f
  });
}
```

---

## (a) Datenmodell

Alle Auth-Tabellen tragen `tenant_id TEXT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE`. Wesentliche Härtungen ggü. Erstentwurf:

- **`UNIQUE(tenant_id, email COLLATE NOCASE)`** statt global-unique + case-sensitiv (A-6). E-Mails werden zusätzlich app-seitig kanonisiert (trim + lowercase + NFC) vor jedem Store/Compare.
- **CHECK-Constraints** auf allen Rollen-Feldern (`auth_user.role`, `auth_user.pending_role`, `auth_invitation.role`) — Freitext-Rollen sind nicht mehr speicherbar (P-7, L).
- **`auth_invitation.role` per CHECK auf `content|admin` begrenzt** — `owner` ist als Invite-Rolle unmöglich (P-2). Token-Index als **Composite `(tenant_id, token_hash)`** (T-4).
- **`pending_role`** auf `auth_user`: privilegierte Rolle wird erst nach vollständigem TOTP-Enrollment aktiv (M-2).
- **`auth_session.mfa_verified_at`** für Step-up-Frische (M-5). **`auth_trusted_device`** neu, um Trusted-Device-Tokens bei Rollen-/MFA-Änderung gezielt zu invalidieren (M-3).
- **`auth_verification.tenant_id`** wird beim Einlösen zwingend gegen den aufgelösten Host-Tenant geprüft (A-8) — Token trägt seine Tenant-Bindung selbst, nicht nur über den Klick-Host.
- **`tenant_domain`** neu: Custom-Domain-Lifecycle mit TXT-Ownership-Proof + Re-Validierung (A-7).
- Demo-/Acme-Seed wird in Prod via `0003_deseed_prod.sql` entfernt (T-1); Staging/lokal seeden über ein separates Dev-Seed-Skript, nicht über Migrationen.

Migration siehe eigenes SQL-Deliverable (`migrations/0002_auth.sql`, `migrations/0003_deseed_prod.sql`).

**Better-Auth-Mapping:** Kern-Modelle auf `auth_*` mappen; composite-UNIQUE-/Partial-Indizes existieren nur im DDL — Eindeutigkeit wird zusätzlich applikativ tenant-scoped erzwungen (§g).

---

## (b) Rechtemodell

**Hierarchie:** `user < content < admin < owner`. Genau **ein** `owner`/Instanz (`uq_user_tenant_owner`).

### Access-Control (`access-control.ts`) — inkl. `user`/`session`-Statements

```ts
const statement = {
  article:  ["read","create","update","delete","publish"],
  member:   ["read","invite","update-role","remove"],
  user:     ["set-role","create","ban","impersonate","set-password"], // P-1: Plugin-Ops sind AC-gedeckelt
  security: ["manage-mfa-policy","view-audit"],
  instance: ["manage-legal","transfer-ownership","delete","manage-billing"],
} as const;
const ac = createAccessControl(statement);
const user    = ac.newRole({ article:["read"] });
const content = ac.newRole({ article:["read","create","update","delete","publish"] });
const admin   = ac.newRole({ ...content.statements,
  member:["read","invite","update-role","remove"], security:["view-audit"] });
const owner   = ac.newRole({ ...admin.statements,
  security:["manage-mfa-policy","view-audit"],
  instance:["manage-legal","transfer-ownership","delete","manage-billing"] });
export const roles = { user, content, admin, owner };
```

**`rank()` fail-closed:** unbekannte/nicht-normalisierte Rolle → `-Infinity` (jede Team-/Owner-Prüfung schlägt fehl statt versehentlich zu passen). Rolle wird vor jedem Schreiben normalisiert (trim/lowercase, Whitelist).

### Serverseitige Prüfung — autoritativ, zweischichtig

1. **Auth-Pipeline (global, D11):** `before`-Hook in `hooks.ts` matcht **jeden** privilegierten Pfad (`/admin/*`, Rollen-/Security-/Instance-Mutationen, `/two-factor/*`) und lehnt mit 403 ab, sofern nicht `role∈{content,admin,owner} ∧ two_factor_enabled=1 ∧ session.mfaVerified=1` (Session serverseitig frisch gelesen, `disableCookieCache`). Damit sind auch die nativen Plugin-Endpunkte gegated (M-1, P-1).
2. **Route-Guard (`guards.ts`):** zusätzlich pro Hono-Route/Server-Action.

```ts
export async function requireTeam(auth, headers, min: "content"|"admin"|"owner") {
  const s = await auth.api.getSession({ headers, query:{ disableCookieCache:true } });
  if (!s) throw new HTTPException(401);
  const { user, session } = s;
  if (session.tenantId !== currentTenantId()) throw new HTTPException(403); // §g
  if (!user.twoFactorEnabled) throw new HTTPException(403, "mfa_setup_required");
  if (!session.mfaVerified)   throw new HTTPException(403, "mfa_verification_required");
  if (rank(user.role) < rank(min)) throw new HTTPException(403);
  return { user, session };
}

// Step-up: frisches TOTP innerhalb freshAge (M-5)
export function requireFreshTotp(session, maxAgeSec = 300) {
  if (!session.mfaVerifiedAt || now() - session.mfaVerifiedAt > maxAgeSec)
    throw new HTTPException(403, "step_up_required");
}
```

**Rollen-Vergabe-Regel:** `admin` darf nur `user↔content`; `admin`/`owner` zu vergeben ist owner-exklusiv **und** verlangt frisches TOTP-Step-up. `owner` wird **nie** per `setRole`/`create-user` gesetzt — ausschließlich über den Transfer-Flow (§c.6). Middleware (`getSessionCookie`) ist **keine** Sicherheitsgrenze — nur optimistische Redirects.

### admin-Plugin-Endpunkte einhegen (P-1, M-1)

- `adminRoles` **nicht** gesetzt (leer) → das Plugin autorisiert nichts mehr selbst.
- Middleware auf `/api/auth/admin/*` überschreibt/erzwingt die eigene AC autoritativ:
  - `set-role`: Zielrolle **≤ content**; `admin`/`owner` strikt owner-exklusiv + Step-up-TOTP; `owner` nie vergebbar.
  - `create-user`: nur `user` erlaubt (Team-Rollen nur via Invite-Flow mit MFA-Gate).
  - `impersonate-user`: **komplett aus** (mindestens für Ziele `admin`/`owner` verboten).
  - `ban-user`/`remove-user`: gegen `owner`/`admin` verboten.
  - `set-user-password`: aus (Reset nur über self-service + Verify).

---

## (c) Flows (gehärtet)

### 1. Registrierung + E-Mail-Verifizierung
1. `signUp.email(...)` → `databaseHooks.user.create.before` kanonisiert E-Mail (trim+lowercase+NFC), injiziert `tenant_id = currentTenantId()`, erzwingt `role='user'`. Tenant-scoped `findUserByEmail` (via Adapter) → existiert `(tenant_id,email)` schon: `USER_ALREADY_EXISTS`.
2. `requireEmailVerification` + Verify-Mail (Token in `auth_verification` **mit tenant_id**). Login vor Verify → 403.
3. Ergebnis: normaler `user`, kein Team.

### 2. Login (Credentials)
- Bei `twoFactorEnabled=1` **keine Session** → `twoFactorRedirect`. Erst nach echtem Zweitfaktor-Verify entsteht Session; after-Hook setzt `session.mfa_verified=1` **und** `mfa_verified_at=now()`. `mfaVerified=1` wird **ausschließlich** bei echtem Verify-Event gesetzt, nie aus Trusted-Device-Skip (M-3).

### 3. Social-Login = nur 1. Faktor, Multi-Tenant-Gateway
- OAuth-Session immer `mfa_verified=0`; `requireTeam`/Pipeline blockt Team-Funktionen → Step-up (TOTP), bzw. MFA-Setup falls `two_factor_enabled=0`. Für admin/owner nur TOTP.
- **OAuth-Gateway (A-3, T-5):** zentraler Callback-Host bedient **keine** Tenant-Auflösung über den Host. Der Tenant kommt **ausschließlich aus dem verifizierten `state`**: AEAD-signiert (per-Tenant-Key), Inhalt `{tenantId, nonce, initiatingOrigin, exp}`, **single-use** (Nonce in KV verbrannt, tenant-präfigiert). **Kein** `user`/`account`-Insert am zentralen Host — Code-Exchange erst nach 302 im Tenant-Kontext, Insert explizit mit `state.tenantId` gescoped. Tenant-Claim wird gegen den initiierenden Origin/Slug geprüft; Mismatch → hart ablehnen + `account.link-attempt-blocked` auditieren.
- **E-Mail-Kollision (A-4):** tenant-scoped `findUserByEmail` **vor** jedem Insert; Kollision Social↔Passwort → deterministisch `account_not_linked` (sauberer 4xx, „mit ursprünglicher Methode anmelden"), **nie** Auto-Link, **nie** zweite Zeile. Integrationstests gegen die installierte better-auth-Version verpflichtend.

### 4. Einladung → Team + MFA-Gate (`invitations.ts`)
1. **CREATE:** Rollen-Deckel: `rank(inviter.role)` MUSS **strikt >** `rank(invite.role)`; `admin` darf max. `content` einladen; `owner` als Invite-Rolle **verboten** (DB-CHECK + App). Partial-Unique `uq_invitation_pending` = max. 1 offene je (Instanz, kanonisierte E-Mail). Ablauf kurz (24 h; admin kürzer). E-Mail kanonisiert gespeichert.
2. Mail-Link `…/invite/accept?token=<secret>` (auf **kanonischem Tenant-Host**, nie zentraler/Fallback-Host).
3. **ACCEPT (serverseitig, tenant-scoped, re-validiert):**
   - Lookup per **`(tenant_id, token_hash)`** (Composite), `status='pending'`, nicht abgelaufen. Nach Fetch `assert(row.tenant_id === currentTenantId())` (T-4).
   - **Rollen-Deckel erneut prüfen** (P-2): Inviter existiert noch, nicht gebannt, `rank(inviter.role) > rank(invite.role)`.
   - **Identitäts-Invariante in BEIDEN Zweigen** (A-5): Rolle wird nur gesetzt, wenn annehmender Account `email_verified=1` **UND** `normalize(account.email) === normalize(invitation.email)`. Neu-User-Zweig bindet die Registrierung fest an `invitation.email` (E-Mail nicht frei wählbar).
   - **Raise-only** (P-2): `role = maxRank(current, invite)` — bestehende höhere Rolle wird nie gesenkt (keine Peer-Degradierung).
   - **Rolle vor MFA parken** (M-2): Zielrolle geht in `pending_role`; die effektive `role` wird erst im `verifyTotp`-Success-Hook (D1 `batch()`) auf `pending_role` gehoben, nachdem `two_factor_enabled=1` gilt.
4. `status='accepted'`, `accepted_by` → single-use. Session-Revoke (§e).

### 5. Passwort-Reset / Recovery
- `requestPasswordReset` (nicht awaiten; identische Antwort → Enumeration-/Timing-Schutz). Token in `auth_verification` **mit tenant_id**; beim Einlösen `token.tenant_id === currentTenantId()` prüfen (A-8), sonst hart ablehnen.
- `resetPassword` mit `revokeSessionsOnPasswordReset`. `changePassword` mit `revokeOtherSessions` **+ Step-up-TOTP** (M-5).

### 6. Ownership-Transfer (owner-exklusiv, atomar, TOCTOU-sicher)
1. `requireOwner` + `requireFreshTotp` (frisches `verify-totp` unmittelbar vor dem `batch()`, M-5).
2. **Bedingungen atomar in die Schreib-Statements** (P-5), tenant_id in **jedem** Statement:
   ```sql
   -- im selben batch():
   UPDATE auth_user SET role='owner'
     WHERE id=:target AND tenant_id=:t AND two_factor_enabled=1 AND role IN ('admin','content');
   UPDATE auth_user SET role='admin'
     WHERE id=:actor AND tenant_id=:t AND role='owner';
   ```
   Danach `affected_rows` prüfen; `!= erwartet` ⇒ Abbruch. `uq_user_tenant_owner` fängt Doppel-Transfer-Race ab.
3. Session-Revoke für **beide** User; Audit `ownership.transfer`.

---

## (d) MFA-Regeln (gehärtet)

- **Plugin-Config:** `twoFactor({ issuer: tenantSlug, skipVerificationOnEnable:false, totpOptions:{period:30}, otpOptions:{sendOTP}, backupCodeOptions:{...}, lockout:{enabled:true, maxFailedAttempts:5} })`. `two_factor_enabled=1` erst nach `verifyTotp` = verlässlicher „TOTP eingerichtet"-Marker für **alle** Team-Rollen.
- **Pflichten:** `content` → MFA Pflicht (2. Faktor TOTP oder Email-OTP); `admin`/`owner` → MFA Pflicht, **nur TOTP**; `user` → keine MFA.
- **Rolle nie vor MFA aktiv (M-2):** Team-Rolle bleibt in `pending_role`, bis TOTP vollständig verifiziert ist — schließt das „Rolle=admin, aber `two_factor_enabled=0`"-Fenster auch für Plugin-Endpunkte.
- **`before`-Hook lehnt für admin/owner ab:** `/two-factor/verify-otp` (Email-OTP) **und** `/two-factor/verify-backup-code` (M-4). Backup-Codes sind für admin/owner kein vollwertiger 2. Faktor; falls doch per Backup-Code eingeloggt, wird vor jeder privilegierten Aktion ein TOTP-Step-up erzwungen und TOTP-Reenroll/Rotation verlangt. Backup-Code-Nutzung wird rate-limitiert + auditiert.
- **`trustDevice` serverseitig hart deaktiviert (M-3):** `before`-Hook für `/sign-in` und `/two-factor/verify-totp` setzt `trustDevice=false` für jeden User mit (potenzieller) Rolle `content/admin/owner`. `mfaVerified=1` **nur** bei echtem Zweitfaktor-Verify-Event dieser Session — nie aus Trusted-Device-Skip. Bei Rollen-/MFA-Change werden **alle Trusted-Device-Tokens** des Users invalidiert (nicht nur Sessions).
- **Step-up (M-5)** verpflichtend (frisches TOTP innerhalb `freshAge`) für: MFA enable/disable, Backup-Code-(Re)Generierung/-Ansicht, MFA-Policy-Änderung, Admin-Einladung, `changePassword`, jeden Rollenwechsel, Ownership-Transfer. Das einmalige Login-`mfaVerified` reicht dafür **nicht**. `manage-mfa-policy` darf die MFA-Pflicht nicht unter das harte Gate senken.
- Backup-Codes: `generateBackupCodes` (überschreibt alte, single-use); `viewBackupCodes` server-only, nur in frischer Session hinter Step-up.

---

## (e) Session-Sicherheit + Widerruf

- Cookies: `httpOnly`, `SameSite=Lax`, `Secure`, **per-Tenant signiert (HKDF)**. **Kein** Parent-Domain-`Domain`, **kein** `crossSubDomainCookies` (host-scoped pro Origin, D9).
- **Session-Tenant-Bindung in zentralem Hook (T-2):** ein session-validierender Hook erzwingt bei **jedem** Endpunkt `session.tenantId === currentTenantId()` — nicht nur in `requireTeam`. Damit sind auch `/get-session`, `/update-user`, `/change-password`, `/list-sessions`, `/two-factor/*`, `/sign-out` gegen instanzfremde Sessions geschützt. Zusätzlich sind KV-Session-Keys tenant-präfigiert (`${tenantId}:session:${token}`) → ein Token ist nur im eigenen Namespace auflösbar; `storeSessionInDatabase:true` leitet Session-Reads zusätzlich durch den tenant-scoped Adapter.
- `cookieCache` global aus (D9) — Widerrufe/entzogene Rollen greifen sofort.
- **Widerruf nach kritischen Änderungen:**
  | Aktion | Mechanismus |
  |---|---|
  | Passwort-Reset | `revokeSessionsOnPasswordReset` |
  | `changePassword` | `revokeOtherSessions` |
  | Rollen-Änderung (Invite-Accept, Transfer) | after-Hook → `revokeSessions(userId)` + Trusted-Device-Invalidierung |
  | MFA enable/disable/Backup-Regen | after-Hook → `revokeOtherSessions()` + Trusted-Device-Invalidierung |
  | Ownership-Transfer | Revoke für beide User |

---

## (f) Rate-Limiting & Audit-Log

**Rate-Limiting**
- `secondary-storage`, **alle Keys tenant-präfigiert** (`${tenantId}:ratelimit:{path}:{ip}`, `${tenantId}:otp:{identifier}`) → keine Cross-Tenant-Drosselung/OTP-Kollision (T-7).
- IP über `cf-connecting-ip` (+ trusted proxies). `auth.api`-Server-Calls werden nicht limitiert → eigene Guards. Defense-in-Depth: Cloudflare-WAF davor.

**Audit-Log (`auth_audit_log`, tenant-scoped, append-only)**
- Befüllung via `hooks.after` (Verzweigung über `ctx.path`) + `databaseHooks`; `ctx.context.newSession` null-checken. Non-blocking. **Reads laufen durch den Tenant-Scoping-Helper** (T-4).
- Mindestaktionen: `login.success/failure`, `logout`, `mfa.enable/disable/verify`, `role.change`, `invite.create/accept/revoke`, `password.reset`, `ownership.transfer`, `session.revoke`, `instance.legal.update`, `account.link-attempt-blocked`, `trusted-device.invalidate`, `admin.endpoint.blocked`.

---

## (g) Tenant-Isolation-Enforcement (Kern-Härtung)

Ein DB-Constraint allein reicht nicht — Better Auths interne Lookups scopen `tenant_id` nicht. Fünf-schichtig, alle fail-closed:

1. **Fail-closed Auflösung (T-1/T-3/A-2):** `resolveTenantStrict(host)` matcht **exakt** gegen bekannte `<slug>.<base>`-Hosts und **verifizierte** `tenant_domain`; kein Treffer ⇒ `null` ⇒ 404/421, Auth-Instanz wird nicht gebaut. **Kein** `defaultTenant`-Fallback. Auf Cloudflare wo möglich pro Hostname routen und Host-Header gegen den CF-bereitgestellten Hostnamen prüfen — ein frei gewählter Host-Header ist **nie** Tenant-Autorität. Apex/www/`auth`-Host bedienen **keine** emailAndPassword/social-Endpunkte. `getDbSafe()===null` im Request ⇒ 503 (kein Registry-Fallback).
2. **Eine Tenant-Quelle (T-6/A-1):** Tenant wird am äußersten, für Hono UND Next gemeinsamen Boundary in die ALS gesetzt und an `createAuth(env, tenant)` gebunden. Better Auth läuft über **einen** Mount, oder beide Mounts nutzen dieselbe tenant-setzende Middleware. Adapter: `assert(currentTenantId() && currentTenantId() === factoryTenantId)`.
3. **Default-deny Adapter-Wrapper (A-1/P-6):** **alle** Adapter-Methoden explizit umschlossen (`findOne/findMany/create/update/updateMany/delete/deleteMany/count/...`); **unbekannte Methoden werfen** (kein Pass-through). `scope()` ist **fail-closed**: `currentTenantId()` null/undefined ⇒ **throw**, nie WHERE-Klausel weglassen. `create`/`update` asserten `tenantId` hart. Read **und** Write scopen `WHERE tenant_id = <current>`.
   ```ts
   const scope = (m, where) => {
     const tid = currentTenantId();
     if (!tid) throw new Error("tenant_context_missing"); // fail-closed
     return { ...where, tenantId: tid };
   };
   findOne:(m,w)=>inner.findOne(m,scope(m,w));   // findMany/update/delete/count analog
   create:(m,d)=>inner.create(m,{ ...d, tenantId: assertTid() });
   // unbekannte Methode: throw new Error("unwrapped_adapter_method:"+name)
   ```
4. **Eigene Tabellen durch denselben Scoping-Helper (T-4):** `auth_invitation`, `auth_audit_log`, `tenant_legal_docs`, `tenant_domain` laufen über den gleichen Helper. Token-Index Composite `(tenant_id, token_hash)`; jeder Invite-Lookup mit `tenant_id` constrained; nach jedem Custom-Fetch `assert(row.tenant_id === currentTenantId())`. Beim Accept zusätzlich: annehmender User-Tenant == Invite-Tenant.
5. **Kryptografische Bindung (T-5):** per-Tenant-Signierschlüssel via `HKDF(AUTH_SECRET, tenantId)` für Cookie- und State-Signatur → instanzfremdes Cookie scheitert an der Signatur. `cookieCache` global aus; nie Parent-Domain-Cookie; OAuth-`state` zwingend signiert + Tenant eingebettet + beim Callback geprüft.

**Account-Linking (A-4/T-4):** `accountLinking.enabled:false`. `linkSocial` für Team-Rollen nur hinter Re-Auth + TOTP-Step-up, sonst gesperrt. `account_not_linked` sauber ans Frontend.

---

## (h) Legal-Docs pro Instanz

- `tenant_legal_docs (tenant_id, doc_type∈{imprint,privacy,terms}, mode∈{link,markdown}, url, markdown)`; Reads/Writes durch den Tenant-Scoping-Helper. Markdown server-seitig sanitized.
- Fehlende Dokumente deutlich (Admin-Banner), **nicht blockierend**. Pflege owner-exklusiv (`instance:manage-legal`) + Step-up; Änderungen ins Audit-Log.

---

## (i) Custom-Domain-Lifecycle (neu, A-7)

- `tenant_domain` mit TXT-Ownership-Proof: Domain wird erst nach verifiziertem TXT-Record `status='verified'` und damit für die Tenant-Auflösung aktiv. **Periodische Re-Validierung**; bei Fehlschlag `status='revoked'` → Host wird abgewiesen (fail-closed, kein Demo-Fallback).
- Deprovisioning-Flow beim Entfernen einer Domain. `tenants.custom_domain` gilt als deprecated; Auflösung nur noch über `tenant_domain` mit `verified`.

---

## Cloudflare / OpenNext / D1 — Fallstricke

- Node-Runtime (kein Edge). `nextCookies()` als letztes Plugin.
- Migrationen via `wrangler d1 migrations apply`; DDL handgeschrieben, forward-only. Demo-Seed nicht in Prod (`0003_deseed_prod.sql`; Staging über Dev-Seed-Skript).
- `transaction:false` → Atomarität via `batch()` + Constraints + affected-rows-Prüfung.
- Passwort-Hashing Workers-tauglich (argon2id-WASM, OWASP-konform).
- Verifizieren vor Umsetzung: installierte `better-auth`-Version (2FA/admin/`disableImplicitLinking`), Verhalten von `accountLinking.enabled:false` per Integrationstest.

## Verpflichtende Isolations-/Regressionstests

1. Unbekannter/leerer/gespoofter Host ⇒ Ablehnung, **nie** Demo-Tenant.
2. In A geminteter Session-Cookie/Invite-Token/Reset-Token ist unter B **nicht** gültig (403), kein A-Audit/Legal-Read unter B.
3. Jedes wrapped-Modell fällt ohne gesetzten Tenant-Kontext hart durch; Next-Route-Handler-Pfad ohne Hono-Middleware gibt **keine** ungescopte Query raus.
4. `admin`-Plugin-Endpunkte: `set-role` >content, `create-user`/`impersonate` mit Team-Rolle, `ban/remove` gegen owner ⇒ alle 403.
5. Route-Enumeration: jede `/api/v1`-Route hat Guard oder explizites `.public()` — sonst bricht der Build.
6. E-Mail-Kollision Social↔Passwort im selben Tenant ⇒ deterministisch `account_not_linked`, keine zweite Zeile.
7. Invite-Accept unter fremder Identität / mit `role>inviter` / raise-only-Verletzung ⇒ Ablehnung.
8. Owner-Transfer: Ziel-MFA wird zwischen Check und Write deaktiviert ⇒ `batch()` schlägt fehl (affected_rows).
