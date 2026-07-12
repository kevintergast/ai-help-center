import { memoryAdapter } from "better-auth/adapters/memory";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import type { AuditEvent, AuditRepository } from "@/server/auth/audit";
import { AUTH_BASE_PATH, buildAuth, tenantAuthOptions } from "@/server/auth/auth";
import type {
  InvitationRecord,
  InvitationRepository,
  NewInvitation,
} from "@/server/auth/invitations";
import type { InvitationEmailData } from "@/server/auth/resend";
import type { TeamUserRepository, TeamUserRow } from "@/server/auth/team-users";
import { buildApiApp } from "./app";
import type { ApiDeps, TeamDeps } from "./context";

/**
 * PHASE-D-VERHALTEN end-to-end über `app.request()` (Muster: app.branding.test.ts):
 * Einladungen (Create/Liste/Revoke), Accept-Flow und Ownership-Transfer —
 * komplett mit Fakes (Memory-Auth, Map-Invitations, Team-Users direkt auf dem
 * Memory-Store, Audit-Array). Jeder Test verhindert einen benennbaren realen
 * Fehlerfall: Rollen-Deckel, Single-use, E-Mail-Bindung, 404-Einheitlichkeit
 * (kein Existenz-Orakel), banned-Gates, Token-Disziplin, Transfer-Atomarität
 * auf Routen-Ebene. Die D1-SQL-Semantik der echten Repositories beweist
 * src/server/auth/team-persistence.test.ts gegen die Migrations-DDL.
 */

const TEST_SECRET = "test-only-secret-value-0123456789-ABCDEF";
const PASSWORD = "correct-horse-battery";

const HOST_A = "tenant-a.hallofhelp.app";
const HOST_B = "tenant-b.hallofhelp.app";

function makeTenant(id: string, slug: string): Tenant {
  return {
    id,
    slug,
    name: slug,
    customDomain: null,
    defaultLocale: "de",
    branding: { logoUrl: null, colorPrimary: "#000", colorAccent: "#111", colorPrimaryFg: "#fff" },
  };
}

const TENANTS: Record<string, Tenant> = {
  [HOST_A]: makeTenant("t_a", "tenant-a"),
  [HOST_B]: makeTenant("t_b", "tenant-b"),
};

type Row = Record<string, unknown>;
type MemoryDb = Record<string, Row[]>;

type StoredInvitation = InvitationRecord & { tokenHash: string };

/** Map-Fake mit EXAKT der D1-Semantik (bedingte Updates → false wenn nicht pending). */
class FakeInvitations implements InvitationRepository {
  readonly rows = new Map<string, StoredInvitation>();

  private pub(r: StoredInvitation): InvitationRecord {
    return {
      id: r.id,
      tenantId: r.tenantId,
      email: r.email,
      role: r.role,
      status: r.status,
      inviterId: r.inviterId,
      expiresAt: r.expiresAt,
      acceptedBy: r.acceptedBy,
      createdAt: r.createdAt,
    };
  }

  async create(inv: NewInvitation): Promise<void> {
    // Spiegelt uq_invitation_pending (Partial-Unique, case-insensitiv).
    for (const r of this.rows.values()) {
      if (
        r.tenantId === inv.tenantId &&
        r.status === "pending" &&
        r.email.toLowerCase() === inv.email.toLowerCase()
      ) {
        throw new Error("uq_invitation_pending violated");
      }
    }
    this.rows.set(inv.id, {
      ...inv,
      status: "pending",
      acceptedBy: null,
      createdAt: Math.floor(Date.now() / 1000),
    });
  }

  async listByTenant(tenantId: string): Promise<InvitationRecord[]> {
    return [...this.rows.values()].filter((r) => r.tenantId === tenantId).map((r) => this.pub(r));
  }

  async findById(tenantId: string, id: string): Promise<InvitationRecord | null> {
    const r = this.rows.get(id);
    return r && r.tenantId === tenantId ? this.pub(r) : null;
  }

  async findPendingByEmail(tenantId: string, email: string): Promise<InvitationRecord | null> {
    for (const r of this.rows.values()) {
      if (
        r.tenantId === tenantId &&
        r.status === "pending" &&
        r.email.toLowerCase() === email.toLowerCase()
      ) {
        return this.pub(r);
      }
    }
    return null;
  }

  async findByTokenHash(tenantId: string, tokenHash: string): Promise<InvitationRecord | null> {
    for (const r of this.rows.values()) {
      // AUSSCHLIESSLICH composite (tenant_id, token_hash) — wie uq_invitation_tenant_token.
      if (r.tenantId === tenantId && r.tokenHash === tokenHash) return this.pub(r);
    }
    return null;
  }

  private transition(
    tenantId: string,
    id: string,
    to: InvitationRecord["status"],
    acceptedBy?: string,
  ): boolean {
    const r = this.rows.get(id);
    if (!r || r.tenantId !== tenantId || r.status !== "pending") return false;
    r.status = to;
    if (acceptedBy !== undefined) r.acceptedBy = acceptedBy;
    return true;
  }

  markAccepted = async (tenantId: string, id: string, acceptedBy: string) =>
    this.transition(tenantId, id, "accepted", acceptedBy);
  markRevoked = async (tenantId: string, id: string) => this.transition(tenantId, id, "revoked");
  markExpired = async (tenantId: string, id: string) => this.transition(tenantId, id, "expired");
}

/**
 * Team-Users DIREKT auf dem geteilten Memory-Auth-Store (auth_user/auth_session)
 * — dieselbe Quelle, die die Sessions speist. `transferOwnership` spiegelt die
 * kreuz-konditionierte D1-Batch-Semantik inkl. banned/2FA-Bedingungen.
 */
class FakeTeamUsers implements TeamUserRepository {
  constructor(private readonly db: MemoryDb) {}

  private find(tenantId: string, userId: string): Row | undefined {
    return this.db.auth_user.find((u) => u.id === userId && u.tenant_id === tenantId);
  }

  async findById(tenantId: string, userId: string): Promise<TeamUserRow | null> {
    const row = this.find(tenantId, userId);
    if (!row) return null;
    return {
      id: row.id as string,
      email: row.email as string,
      role: (row.role as string) ?? "user",
      pendingRole: (row.pending_role as string | null) ?? null,
      twoFactorEnabled: !!row.two_factor_enabled,
      banned: !!row.banned,
    };
  }

  async transferOwnership(tenantId: string, actorId: string, targetId: string): Promise<boolean> {
    const actor = this.find(tenantId, actorId);
    const target = this.find(tenantId, targetId);
    const targetTransferable =
      !!target &&
      ["admin", "content"].includes((target.role as string) ?? "") &&
      !!target.two_factor_enabled &&
      !target.banned;
    if (!actor || actor.role !== "owner" || !targetTransferable) return false;
    actor.role = "admin";
    target!.role = "owner";
    target!.pending_role = null;
    return true;
  }

  async revokeSessions(tenantId: string, userId: string): Promise<void> {
    const sessions = this.db.auth_session;
    for (let i = sessions.length - 1; i >= 0; i--) {
      if (sessions[i].tenant_id === tenantId && sessions[i].user_id === userId) {
        sessions.splice(i, 1);
      }
    }
  }
}

class FakeAudit implements AuditRepository {
  readonly entries: AuditEvent[] = [];
  async append(event: AuditEvent): Promise<void> {
    this.entries.push(event);
  }
}

type EmailMode = "sent" | "noop" | "fail";

function makeApp(opts: { teamAvailable?: boolean; emailMode?: EmailMode } = {}) {
  const { teamAvailable = true, emailMode = "noop" } = opts;
  const db: MemoryDb = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
    auth_two_factor: [],
  };
  const invitations = new FakeInvitations();
  const users = new FakeTeamUsers(db);
  const audit = new FakeAudit();
  const sentEmails: InvitationEmailData[] = [];

  const team: TeamDeps = {
    invitations,
    users,
    audit,
    sendInvitationEmail: async (data) => {
      if (emailMode === "fail") throw new Error("resend down (Test)");
      if (emailMode === "noop") return false;
      sentEmails.push(data);
      return true;
    },
  };

  const deps: ApiDeps = {
    resolveTenant: async (host) => {
      const hostname = (host ?? "").split(":")[0].toLowerCase();
      return TENANTS[hostname] ?? null;
    },
    createAuthForTenant: async () =>
      buildAuth({ adapter: memoryAdapter(db)(tenantAuthOptions(TEST_SECRET)), secret: TEST_SECRET }),
    getBrandingDeps: async () => null,
    getTeamDeps: async () => (teamAvailable ? team : null),
    getLegalDeps: async () => null,
    getContentDeps: async () => null,
  };
  return { app: buildApiApp(deps), db, invitations, users, audit, sentEmails };
}

type Fixture = ReturnType<typeof makeApp>;
type TestApp = Fixture["app"];

function postJson(app: TestApp, path: string, host: string, body: unknown, cookie?: string) {
  return app.request(path, {
    method: "POST",
    headers: {
      host,
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
    },
    body: JSON.stringify(body),
  });
}

/** Session per echtem Sign-up/Sign-in; Rollen-/MFA-Flags als Store-Fixture. */
async function createSession(
  app: TestApp,
  db: MemoryDb,
  host: string,
  email: string,
  opts: { role?: string; mfa?: boolean; freshMfa?: boolean } = {},
): Promise<string> {
  const tenantId = TENANTS[host].id;

  const signUp = await postJson(app, `${AUTH_BASE_PATH}/sign-up/email`, host, {
    email,
    password: PASSWORD,
    name: "Test",
  });
  expect(signUp.status).toBe(200);

  const user = db.auth_user.find((u) => u.email === email && u.tenant_id === tenantId);
  expect(user).toBeTruthy();
  user!.email_verified = true;
  if (opts.role) user!.role = opts.role;

  const signIn = await postJson(app, `${AUTH_BASE_PATH}/sign-in/email`, host, {
    email,
    password: PASSWORD,
  });
  expect(signIn.status).toBe(200);

  // MFA-Flags erst NACH dem Sign-in (sonst greift die echte 2FA-Challenge).
  if (opts.mfa || opts.freshMfa) {
    user!.two_factor_enabled = true;
    const session = db.auth_session.filter((s) => s.user_id === user!.id).at(-1);
    expect(session).toBeTruthy();
    session!.mfa_verified = true;
    if (opts.freshMfa) session!.mfa_verified_at = Math.floor(Date.now() / 1000);
  }

  return signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

const adminSession = (f: Fixture, host: string, email = `admin-${host}@example.com`) =>
  createSession(f.app, f.db, host, email, { role: "admin", mfa: true });
const ownerSession = (f: Fixture, host: string, email = `owner-${host}@example.com`) =>
  createSession(f.app, f.db, host, email, { role: "owner", mfa: true, freshMfa: true });

function invite(f: Fixture, host: string, cookie: string, email: string, role: string) {
  return postJson(f.app, "/api/v1/admin/invitations", host, { email, role }, cookie);
}

/** Erstellt eine Einladung und liefert Roh-Token (aus devAcceptUrl) + id. */
async function inviteWithToken(
  f: Fixture,
  host: string,
  cookie: string,
  email: string,
  role: string,
): Promise<{ token: string; id: string }> {
  const res = await invite(f, host, cookie, email, role);
  expect(res.status).toBe(201);
  const json = (await res.json()) as { id: string; devAcceptUrl: string };
  expect(json.devAcceptUrl).toBeTruthy();
  const token = new URL(json.devAcceptUrl).searchParams.get("token");
  expect(token).toBeTruthy();
  return { token: token!, id: json.id };
}

const accept = (f: Fixture, host: string, token: string, cookie?: string) =>
  postJson(f.app, "/api/v1/invitations/accept", host, { token }, cookie);

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("POST /api/v1/admin/invitations (Rollen-Deckel, Token-Disziplin, Versand)", () => {
  it("admin lädt content ein → 201; Token NUR im Mail-Link (kein devAcceptUrl bei sent=true, kein Token/Hash in Response/Audit)", async () => {
    const f = makeApp({ emailMode: "sent" });
    const cookie = await adminSession(f, HOST_A);

    const res = await invite(f, HOST_A, cookie, "Invitee@Example.com ", "content");
    expect(res.status).toBe(201);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ email: "invitee@example.com", role: "content", status: "pending" });
    expect(body.devAcceptUrl).toBeUndefined();

    // Mail ging an die kanonisierte Adresse, Link auf der SLUG-Subdomain (A-7).
    expect(f.sentEmails).toHaveLength(1);
    expect(f.sentEmails[0].to).toBe("invitee@example.com");
    expect(f.sentEmails[0].acceptUrl).toMatch(
      /^https:\/\/tenant-a\.hallofhelp\.app\/invite\/accept\?token=/,
    );
    const token = new URL(f.sentEmails[0].acceptUrl).searchParams.get("token")!;
    const stored = f.invitations.rows.get(body.id as string)!;

    // Token-Disziplin: weder Roh-Token noch Hash verlassen die Persistenz.
    expect(stored.tokenHash).not.toBe(token);
    expect(JSON.stringify(body)).not.toContain(token);
    expect(JSON.stringify(body)).not.toContain(stored.tokenHash);
    expect(JSON.stringify(f.audit.entries)).not.toContain(token);
    expect(JSON.stringify(f.audit.entries)).not.toContain(stored.tokenHash);

    // Liste enthält den Eintrag ohne Hash:
    const list = await f.app.request("/api/v1/admin/invitations", {
      headers: { host: HOST_A, cookie },
    });
    expect(list.status).toBe(200);
    expect(JSON.stringify(await list.json())).not.toContain(stored.tokenHash);
  });

  it("ROLLEN-DECKEL (strikt >): admin→admin 403 role_not_allowed, owner→admin 201; owner ist nie einladbar (400)", async () => {
    const f = makeApp();
    const admin = await adminSession(f, HOST_A);
    const owner = await ownerSession(f, HOST_A);

    const denied = await invite(f, HOST_A, admin, "peer@example.com", "admin");
    expect(denied.status).toBe(403);
    expect(await denied.json()).toMatchObject({ error: "role_not_allowed" });
    expect(f.invitations.rows.size).toBe(0);

    expect((await invite(f, HOST_A, owner, "peer@example.com", "admin")).status).toBe(201);
    const asOwner = await invite(f, HOST_A, owner, "boss@example.com", "owner");
    expect(asOwner.status).toBe(400);
    expect(await asOwner.json()).toMatchObject({ error: "invalid_role" });
  });

  it("RE-INVITE: owner ersetzt eigene offene Einladung (alt revoked); admin kann eine offene ADMIN-Einladung nicht entwerten → 409", async () => {
    const f = makeApp();
    const owner = await ownerSession(f, HOST_A);
    const admin = await adminSession(f, HOST_A);

    const first = await inviteWithToken(f, HOST_A, owner, "vip@example.com", "admin");

    // admin dürfte die offene admin-Einladung nicht revoken → auch kein Ersetzen:
    const blocked = await invite(f, HOST_A, admin, "vip@example.com", "content");
    expect(blocked.status).toBe(409);
    expect(await blocked.json()).toMatchObject({ error: "invitation_pending" });
    expect(f.invitations.rows.get(first.id)?.status).toBe("pending");

    // owner ersetzt: alte revoked, neue pending — Partial-Unique bleibt gewahrt.
    const replaced = await invite(f, HOST_A, owner, "vip@example.com", "content");
    expect(replaced.status).toBe(201);
    expect(f.invitations.rows.get(first.id)?.status).toBe("revoked");
    const pending = [...f.invitations.rows.values()].filter(
      (r) => r.status === "pending" && r.email === "vip@example.com",
    );
    expect(pending).toHaveLength(1);
    expect(pending[0].role).toBe("content");
  });

  it("FAIL-CLOSED Prod-Misskonfiguration: kein Versand-Key + NODE_ENV=production → 503, KEIN devAcceptUrl, Einladung storniert", async () => {
    const f = makeApp({ emailMode: "noop" });
    const cookie = await adminSession(f, HOST_A);
    vi.stubEnv("NODE_ENV", "production");
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await invite(f, HOST_A, cookie, "invitee@example.com", "content");
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body).toMatchObject({ error: "invitation_email_unconfigured" });
    expect(JSON.stringify(body)).not.toContain("token");

    // Keine einlösbare Einladung zurückgelassen:
    const statuses = [...f.invitations.rows.values()].map((r) => r.status);
    expect(statuses).toEqual(["revoked"]);
    errorSpy.mockRestore();
  });

  it("dev (kein Key, NODE_ENV!=production) → 201 MIT devAcceptUrl; echter Zustellfehler → 502 + storniert", async () => {
    const dev = makeApp({ emailMode: "noop" });
    const devCookie = await adminSession(dev, HOST_A);
    const created = await inviteWithToken(dev, HOST_A, devCookie, "dev@example.com", "content");
    expect(dev.invitations.rows.get(created.id)?.status).toBe("pending");

    const failing = makeApp({ emailMode: "fail" });
    const failCookie = await adminSession(failing, HOST_A);
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const res = await invite(failing, HOST_A, failCookie, "invitee@example.com", "content");
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ error: "invitation_email_failed" });
    expect([...failing.invitations.rows.values()].map((r) => r.status)).toEqual(["revoked"]);
    errorSpy.mockRestore();
  });

  it("fehlende Team-Bindings → 503 team_unavailable (fail-closed); kaputte Eingaben → 400", async () => {
    const unavailable = makeApp({ teamAvailable: false });
    const cookie = await adminSession(unavailable, HOST_A);
    const res = await invite(unavailable, HOST_A, cookie, "x@example.com", "content");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ error: "team_unavailable" });

    const f = makeApp();
    const admin = await adminSession(f, HOST_A);
    expect((await invite(f, HOST_A, admin, "not-an-email", "content")).status).toBe(400);
    expect((await invite(f, HOST_A, admin, "x@example.com", "superadmin")).status).toBe(400);
  });
});

describe("DELETE /api/v1/admin/invitations/:id (Revoke-Deckel)", () => {
  it("admin revoked content-Invite (200, zweites Mal 409); owner-admin-Invite ist für admin tabu (403); unbekannte id 404", async () => {
    const f = makeApp();
    const owner = await ownerSession(f, HOST_A);
    const admin = await adminSession(f, HOST_A);

    const contentInv = await inviteWithToken(f, HOST_A, admin, "c@example.com", "content");
    const adminInv = await inviteWithToken(f, HOST_A, owner, "a@example.com", "admin");

    const del = (id: string, cookie: string) =>
      f.app.request(`/api/v1/admin/invitations/${id}`, {
        method: "DELETE",
        headers: { host: HOST_A, cookie },
      });

    const tabu = await del(adminInv.id, admin);
    expect(tabu.status).toBe(403);
    expect(await tabu.json()).toMatchObject({ error: "role_not_allowed" });
    expect(f.invitations.rows.get(adminInv.id)?.status).toBe("pending");

    expect((await del(contentInv.id, admin)).status).toBe(200);
    expect(f.invitations.rows.get(contentInv.id)?.status).toBe("revoked");
    const again = await del(contentInv.id, admin);
    expect(again.status).toBe(409);
    expect(await again.json()).toMatchObject({ error: "invitation_not_pending" });

    expect((await del("does-not-exist", admin)).status).toBe(404);
  });
});

describe("POST /api/v1/invitations/accept (Session-Pflicht, E-Mail-Bindung, Single-use)", () => {
  it("ohne Session → 401 (Default-Deny, Route ist bewusst NICHT public)", async () => {
    const f = makeApp();
    const res = await accept(f, HOST_A, "some-token-1234567890");
    expect(res.status).toBe(401);
  });

  it("Token aus fremdem Tenant → EINHEITLICH 404 (kein Cross-Tenant-Orakel)", async () => {
    const f = makeApp();
    const admin = await adminSession(f, HOST_A);
    const { token } = await inviteWithToken(f, HOST_A, admin, "invitee@example.com", "content");

    const cookieB = await createSession(f.app, f.db, HOST_B, "invitee@example.com");
    const res = await accept(f, HOST_B, token, cookieB);
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ error: "invitation_not_found" });
  });

  it("E-Mail-Bindung: fremde ODER unverifizierte E-Mail → 403 email_mismatch (ein Code, kein Orakel)", async () => {
    const f = makeApp();
    const admin = await adminSession(f, HOST_A);
    const { token, id } = await inviteWithToken(f, HOST_A, admin, "invitee@example.com", "content");

    const wrong = await createSession(f.app, f.db, HOST_A, "other@example.com");
    const mismatch = await accept(f, HOST_A, token, wrong);
    expect(mismatch.status).toBe(403);
    expect(await mismatch.json()).toMatchObject({ error: "email_mismatch" });

    const right = await createSession(f.app, f.db, HOST_A, "invitee@example.com");
    // Verifikation NACH dem Sign-in wieder entziehen → gleiche Antwort:
    f.db.auth_user.find((u) => u.email === "invitee@example.com" && u.tenant_id === "t_a")!.email_verified =
      false;
    const unverified = await accept(f, HOST_A, token, right);
    expect(unverified.status).toBe(403);
    expect(await unverified.json()).toMatchObject({ error: "email_mismatch" });
    expect(f.invitations.rows.get(id)?.status).toBe("pending"); // unkonsumiert
  });

  it("abgelaufen → 410 + Status wird als expired PERSISTIERT", async () => {
    const f = makeApp();
    const admin = await adminSession(f, HOST_A);
    const { token, id } = await inviteWithToken(f, HOST_A, admin, "invitee@example.com", "content");
    f.invitations.rows.get(id)!.expiresAt = Math.floor(Date.now() / 1000) - 10;

    const cookie = await createSession(f.app, f.db, HOST_A, "invitee@example.com");
    const res = await accept(f, HOST_A, token, cookie);
    expect(res.status).toBe(410);
    expect(await res.json()).toMatchObject({ error: "invitation_expired" });
    expect(f.invitations.rows.get(id)?.status).toBe("expired");

    // erneuter Versuch: kein pending mehr → einheitlich 404
    expect((await accept(f, HOST_A, token, cookie)).status).toBe(404);
  });

  it("happy path: pending_role wird GEPARKT (role bleibt user, Session bleibt), Einladung single-use; zweiter paralleler Accept → 404", async () => {
    const f = makeApp();
    const admin = await adminSession(f, HOST_A);
    const { token, id } = await inviteWithToken(f, HOST_A, admin, "invitee@example.com", "content");
    const cookie = await createSession(f.app, f.db, HOST_A, "invitee@example.com");

    const res = await accept(f, HOST_A, token, cookie);
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, role: "content", pendingMfaEnrollment: true });

    const user = f.db.auth_user.find(
      (u) => u.email === "invitee@example.com" && u.tenant_id === "t_a",
    )!;
    expect(user.pending_role).toBe("content"); // M-2: geparkt, NIE role direkt
    expect(user.role).toBe("user");
    // KEIN Session-Revoke beim Accept (§e: erst die Promotion revoked):
    expect(f.db.auth_session.some((s) => s.user_id === user.id)).toBe(true);

    const inv = f.invitations.rows.get(id)!;
    expect(inv.status).toBe("accepted");
    expect(inv.acceptedBy).toBe(user.id);

    // Single-use: derselbe Token nochmal → einheitlich 404.
    expect((await accept(f, HOST_A, token, cookie)).status).toBe(404);

    // Token-Disziplin im Audit-Log (created/accepted geloggt, nie das Token):
    expect(f.audit.entries.map((e) => e.action)).toContain("invitation.accepted");
    expect(JSON.stringify(f.audit.entries)).not.toContain(token);
  });

  it("RAISE-ONLY: bestehende Rolle >= Zielrolle → 409 already_team_member, Einladung als accepted-NOOP konsumiert (Partial-Unique-Blocker weg)", async () => {
    const f = makeApp();
    const admin = await adminSession(f, HOST_A);
    const { token, id } = await inviteWithToken(f, HOST_A, admin, "member@example.com", "content");
    const cookie = await createSession(f.app, f.db, HOST_A, "member@example.com", {
      role: "content",
    });

    const res = await accept(f, HOST_A, token, cookie);
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "already_team_member" });
    expect(f.invitations.rows.get(id)?.status).toBe("accepted");
    const user = f.db.auth_user.find((u) => u.email === "member@example.com")!;
    expect(user.role).toBe("content"); // nie gesenkt
    expect(user.pending_role ?? null).toBeNull();
  });

  it("Inviter-Recheck (P-2): degradierter ODER gebannter Inviter → 409 invitation_role_conflict, unkonsumiert", async () => {
    const f = makeApp();
    const admin = await adminSession(f, HOST_A);
    const { token, id } = await inviteWithToken(f, HOST_A, admin, "invitee@example.com", "content");
    const cookie = await createSession(f.app, f.db, HOST_A, "invitee@example.com");
    const inviter = f.db.auth_user.find(
      (u) => u.email === `admin-${HOST_A}@example.com` && u.tenant_id === "t_a",
    )!;

    inviter.role = "content"; // nicht mehr STRIKT über der Invite-Rolle
    const demoted = await accept(f, HOST_A, token, cookie);
    expect(demoted.status).toBe(409);
    expect(await demoted.json()).toMatchObject({ error: "invitation_role_conflict" });

    inviter.role = "admin";
    inviter.banned = true;
    const banned = await accept(f, HOST_A, token, cookie);
    expect(banned.status).toBe(409);
    expect(f.invitations.rows.get(id)?.status).toBe("pending");
  });

  it("GEBANNTER Annehmender → 403, Einladung bleibt pending, keine pending_role (Regression: banned-Gate im Accept)", async () => {
    const f = makeApp();
    const admin = await adminSession(f, HOST_A);
    const { token, id } = await inviteWithToken(f, HOST_A, admin, "invitee@example.com", "content");
    const cookie = await createSession(f.app, f.db, HOST_A, "invitee@example.com");
    const user = f.db.auth_user.find(
      (u) => u.email === "invitee@example.com" && u.tenant_id === "t_a",
    )!;
    user.banned = true;

    const res = await accept(f, HOST_A, token, cookie);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "forbidden" });
    expect(f.invitations.rows.get(id)?.status).toBe("pending");
    expect(user.pending_role ?? null).toBeNull();
  });
});

describe("POST /api/v1/admin/ownership/transfer (§c.6: owner + frisches Step-up)", () => {
  it("owner OHNE frisches TOTP-Step-up → 403 mfa_stepup_required (requireFreshMfa greift)", async () => {
    const f = makeApp();
    const stale = await createSession(f.app, f.db, HOST_A, "owner@example.com", {
      role: "owner",
      mfa: true, // mfa_verified, aber KEIN mfa_verified_at
    });
    const res = await postJson(
      f.app,
      "/api/v1/admin/ownership/transfer",
      HOST_A,
      { targetUserId: "whoever" },
      stale,
    );
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "mfa_stepup_required" });
  });

  it("Vorab-Checks: Selbst-Transfer 400, unbekanntes Ziel 404, role=user 409, ohne TOTP 409, GEBANNT 409 (Regression)", async () => {
    const f = makeApp();
    const owner = await ownerSession(f, HOST_A);
    const ownerRow = f.db.auth_user.find((u) => u.email === `owner-${HOST_A}@example.com`)!;

    const transfer = (targetUserId: string) =>
      postJson(f.app, "/api/v1/admin/ownership/transfer", HOST_A, { targetUserId }, owner);

    expect((await transfer(ownerRow.id as string)).status).toBe(400);
    expect((await transfer("ghost")).status).toBe(404);

    await createSession(f.app, f.db, HOST_A, "plain@example.com"); // role user
    const plain = f.db.auth_user.find((u) => u.email === "plain@example.com")!;
    const roleRes = await transfer(plain.id as string);
    expect(roleRes.status).toBe(409);
    expect(await roleRes.json()).toMatchObject({ error: "invalid_target_role" });

    await createSession(f.app, f.db, HOST_A, "no2fa@example.com", { role: "admin" });
    const no2fa = f.db.auth_user.find((u) => u.email === "no2fa@example.com")!;
    const mfaRes = await transfer(no2fa.id as string);
    expect(mfaRes.status).toBe(409);
    expect(await mfaRes.json()).toMatchObject({ error: "target_mfa_required" });

    await createSession(f.app, f.db, HOST_A, "banned@example.com", { role: "admin", mfa: true });
    const banned = f.db.auth_user.find((u) => u.email === "banned@example.com")!;
    banned.banned = true;
    const bannedRes = await transfer(banned.id as string);
    expect(bannedRes.status).toBe(409);
    expect(await bannedRes.json()).toMatchObject({ error: "target_banned" });
    // Nichts davon hat den Owner gewechselt:
    expect(ownerRow.role).toBe("owner");
  });

  it("happy path: Rollen atomar getauscht, Sessions BEIDER revoked (alte Owner-Session danach 401), Audit ownership.transferred", async () => {
    const f = makeApp();
    const owner = await ownerSession(f, HOST_A);
    await createSession(f.app, f.db, HOST_A, "target@example.com", { role: "admin", mfa: true });
    const ownerRow = f.db.auth_user.find((u) => u.email === `owner-${HOST_A}@example.com`)!;
    const targetRow = f.db.auth_user.find((u) => u.email === "target@example.com")!;
    targetRow.pending_role = "admin"; // wird beim Promote genullt

    const res = await postJson(
      f.app,
      "/api/v1/admin/ownership/transfer",
      HOST_A,
      { targetUserId: targetRow.id },
      owner,
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true });

    expect(ownerRow.role).toBe("admin");
    expect(targetRow.role).toBe("owner");
    expect(targetRow.pending_role).toBeNull();

    // §e: beide Session-Sets sind weg …
    expect(f.db.auth_session.some((s) => s.user_id === ownerRow.id)).toBe(false);
    expect(f.db.auth_session.some((s) => s.user_id === targetRow.id)).toBe(false);
    // … und die alte Owner-Session ist tot (401 auf der nächsten Aktion):
    const replay = await postJson(
      f.app,
      "/api/v1/admin/ownership/transfer",
      HOST_A,
      { targetUserId: targetRow.id },
      owner,
    );
    expect(replay.status).toBe(401);

    const entry = f.audit.entries.find((e) => e.action === "ownership.transferred");
    expect(entry).toMatchObject({ tenantId: "t_a", targetId: targetRow.id });
  });

  it("Batch meldet Konflikt (TOCTOU-Race) → 409 transfer_conflict, keine Sessions revoked", async () => {
    const f = makeApp();
    const owner = await ownerSession(f, HOST_A);
    await createSession(f.app, f.db, HOST_A, "target@example.com", { role: "admin", mfa: true });
    const targetRow = f.db.auth_user.find((u) => u.email === "target@example.com")!;

    // Vorab-Checks bestehen, aber der autoritative Batch greift nicht
    // (z. B. paralleler Transfer hat gewonnen):
    f.users.transferOwnership = async () => false;

    const res = await postJson(
      f.app,
      "/api/v1/admin/ownership/transfer",
      HOST_A,
      { targetUserId: targetRow.id },
      owner,
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ error: "transfer_conflict" });
    expect(f.db.auth_session.some((s) => s.user_id === targetRow.id)).toBe(true);
    expect(f.audit.entries.some((e) => e.action === "ownership.transferred")).toBe(false);
  });
});
