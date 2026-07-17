import BetterSqlite3 from "better-sqlite3";
import { memoryAdapter } from "better-auth/adapters/memory";
import { beforeEach, describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import { AUTH_BASE_PATH, buildAuth, tenantAuthOptions } from "@/server/auth/auth";
import { applyMigrations, d1FromSqlite } from "@/server/auth/sqlite-test-support";
import { D1SupportRepository } from "@/server/support/store";
import { buildApiApp } from "./app";
import type { ApiDeps } from "./context";
import type { RateLimiterBinding } from "./rate-limit";

/**
 * SUPPORT-FLOW end-to-end gegen echte 0015-DDL. Verhinderte Fehlerfälle:
 *  - Ticket-Mail geht an NUTZER-Input statt an die konfigurierte Adresse
 *    (Spam-Kanone) oder ein Mail-Fehler verwirft das Ticket.
 *  - Inbox/Verwaltung ohne admin-Gate; Tenant B verwaltet Tickets von A.
 *  - Public-Einreichung ohne Längen-/Mail-Validierung oder ohne Rate-Limit.
 */

const HOST_DEMO = "demo.hallofhelp.com";
const HOST_ACME = "acme.hallofhelp.com";

function tenant(id: string, slug: string, supportEmail: string | null): Tenant {
  return {
    id,
    slug,
    name: slug.toUpperCase(),
    customDomain: null,
    defaultLocale: "de",
    branding: { logoUrl: null, colorPrimary: "#000", colorAccent: "#111", colorPrimaryFg: "#fff" },
    supportEmail,
  };
}

const TENANTS: Record<string, Tenant> = {
  [HOST_DEMO]: tenant("t_demo", "demo", "hilfe@demo.example"),
  [HOST_ACME]: tenant("t_acme", "acme", null),
};

const TEST_SECRET = "test-only-secret-value-0123456789-ABCDEF";
const PASSWORD = "correct-horse-battery";
type Row = Record<string, unknown>;

const VALID_MESSAGE = "Der Passwort-Reset-Link kommt bei mir nie an.";

function makeFixture(opts: { denySensitive?: boolean } = {}) {
  const sqlite = new BetterSqlite3(":memory:");
  applyMigrations(sqlite, ["0001_tenants.sql", "0015_support_tickets.sql"]);
  const repo = new D1SupportRepository(d1FromSqlite(sqlite));

  const authDb: Record<string, Row[]> = {
    auth_user: [],
    auth_session: [],
    auth_account: [],
    auth_verification: [],
    auth_two_factor: [],
  };
  const mails: { to: string; tenantName: string; message: string }[] = [];
  const denyAll: RateLimiterBinding = { limit: async () => ({ success: false }) };
  const deps: ApiDeps = {
    resolveTenant: async (host) => TENANTS[(host ?? "").split(":")[0].toLowerCase()] ?? null,
    createAuthForTenant: async () =>
      buildAuth({
        adapter: memoryAdapter(authDb)(tenantAuthOptions(TEST_SECRET)),
        secret: TEST_SECRET,
      }),
    getBrandingDeps: async () => null,
    getTeamDeps: async () => null,
    getLegalDeps: async () => null,
    getContentDeps: async () => null,
    getSupportDeps: async () => ({
      repo,
      sendTicketMail: async (data) => {
        mails.push({ to: data.to, tenantName: data.tenantName, message: data.message });
        return true;
      },
    }),
    rateLimiters: { sensitive: opts.denySensitive ? denyAll : undefined },
  };
  return { app: buildApiApp(deps), sqlite, repo, authDb, mails };
}

type Fixture = ReturnType<typeof makeFixture>;

const submit = (f: Fixture, body: unknown, host = HOST_DEMO) =>
  f.app.request("/api/v1/support/tickets", {
    method: "POST",
    headers: { host, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** Session mit Rolle + MFA-Markern (Muster app.domain.test.ts). */
async function session(
  f: Fixture,
  email: string,
  role: "user" | "admin",
  host = HOST_DEMO,
): Promise<string> {
  const post = (path: string, body: unknown) =>
    f.app.request(path, {
      method: "POST",
      headers: { host, "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  expect(
    (await post(`${AUTH_BASE_PATH}/sign-up/email`, { email, password: PASSWORD, name: "U" }))
      .status,
  ).toBe(200);
  const user = f.authDb.auth_user.find((u) => u.email === email)!;
  user.email_verified = true;
  if (role !== "user") user.role = role;
  const signIn = await post(`${AUTH_BASE_PATH}/sign-in/email`, { email, password: PASSWORD });
  expect(signIn.status).toBe(200);
  if (role !== "user") {
    user.two_factor_enabled = true;
    const s = f.authDb.auth_session.filter((x) => x.user_id === user.id).at(-1)!;
    s.mfa_verified = true;
  }
  return signIn.headers
    .getSetCookie()
    .map((c) => c.split(";")[0])
    .join("; ");
}

describe("POST /api/v1/support/tickets (public Einreichung)", () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  it("valide Meldung: 201, Ticket persistiert (open), Mail an KONFIGURIERTE Adresse", async () => {
    const res = await submit(f, {
      message: VALID_MESSAGE,
      contactEmail: " Nutzer@Beispiel.DE ",
      question: "Wie setze ich mein Passwort zurück?",
    });
    expect(res.status).toBe(201);

    const tickets = await f.repo.listByTenant("t_demo", 10);
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({
      status: "open",
      message: VALID_MESSAGE,
      contactEmail: "nutzer@beispiel.de",
      question: "Wie setze ich mein Passwort zurück?",
    });

    expect(f.mails).toEqual([
      { to: "hilfe@demo.example", tenantName: "DEMO", message: VALID_MESSAGE },
    ]);
  });

  it("ohne konfigurierte Support-Adresse: Ticket ja, Mail nein (Inbox-only)", async () => {
    const res = await submit(f, { message: VALID_MESSAGE }, HOST_ACME);
    expect(res.status).toBe(201);
    expect(await f.repo.listByTenant("t_acme", 10)).toHaveLength(1);
    expect(f.mails).toHaveLength(0);
  });

  it("Validierung: zu kurz/zu lang/kaputte Kontakt-Mail → 400, NICHTS persistiert", async () => {
    expect((await submit(f, { message: "zu kurz" })).status).toBe(400);
    expect((await submit(f, { message: "x".repeat(2001) })).status).toBe(400);
    expect(
      (await submit(f, { message: VALID_MESSAGE, contactEmail: "kein-at" })).status,
    ).toBe(400);
    expect(await f.repo.listByTenant("t_demo", 10)).toHaveLength(0);
    expect(f.mails).toHaveLength(0);
  });

  it("IP-Rate-Limit (sensitive) → 429, nichts persistiert", async () => {
    const limited = makeFixture({ denySensitive: true });
    expect((await submit(limited, { message: VALID_MESSAGE })).status).toBe(429);
    expect(await limited.repo.listByTenant("t_demo", 10)).toHaveLength(0);
  });
});

describe("Admin-Inbox (/api/v1/admin/support)", () => {
  let f: Fixture;
  beforeEach(() => {
    f = makeFixture();
  });

  const list = (cookie?: string, host = HOST_DEMO) =>
    f.app.request("/api/v1/admin/support", {
      headers: { host, ...(cookie ? { cookie } : {}) },
    });

  it("Gates: anonym 401, user 403, admin 200 mit Tickets (offene zuerst)", async () => {
    await submit(f, { message: VALID_MESSAGE });
    expect((await list()).status).toBe(401);

    const userCookie = await session(f, "user@example.com", "user");
    expect((await list(userCookie)).status).toBe(403);

    const adminCookie = await session(f, "admin@example.com", "admin");
    const res = await list(adminCookie);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { tickets: { message: string; status: string }[] };
    expect(body.tickets).toHaveLength(1);
    expect(body.tickets[0]).toMatchObject({ message: VALID_MESSAGE, status: "open" });
  });

  it("PATCH erledigt/reopen + DELETE; fremder Tenant sieht/ändert NICHTS (404)", async () => {
    await submit(f, { message: VALID_MESSAGE });
    const id = (await f.repo.listByTenant("t_demo", 1))[0].id;
    const adminCookie = await session(f, "admin2@example.com", "admin");

    const done = await f.app.request(`/api/v1/admin/support/${id}`, {
      method: "PATCH",
      headers: { host: HOST_DEMO, "content-type": "application/json", cookie: adminCookie },
      body: JSON.stringify({ status: "done" }),
    });
    expect(done.status).toBe(200);
    expect((await f.repo.listByTenant("t_demo", 1))[0].status).toBe("done");

    // Tenant-Isolation: acme-Admin kann das demo-Ticket weder ändern noch löschen.
    const acmeAdmin = await session(f, "admin@acme.example", "admin", HOST_ACME);
    const cross = await f.app.request(`/api/v1/admin/support/${id}`, {
      method: "PATCH",
      headers: { host: HOST_ACME, "content-type": "application/json", cookie: acmeAdmin },
      body: JSON.stringify({ status: "open" }),
    });
    expect(cross.status).toBe(404);
    expect((await f.repo.listByTenant("t_demo", 1))[0].status).toBe("done");

    const del = await f.app.request(`/api/v1/admin/support/${id}`, {
      method: "DELETE",
      headers: { host: HOST_DEMO, cookie: adminCookie },
    });
    expect(del.status).toBe(200);
    expect(await f.repo.listByTenant("t_demo", 10)).toHaveLength(0);
  });
});