import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { D1AuditRepository } from "./audit";
import { D1InvitationRepository, hashInvitationToken } from "./invitations";
import { applyMigrations, d1FromSqlite } from "./sqlite-test-support";
import { D1TeamUserRepository } from "./team-users";

/**
 * REAL-DDL-TESTS (Muster: schema-parity.test.ts): die handgeschriebenen
 * SQL-Statements der Phase-D-Repositories laufen gegen die ECHTEN Migrationen
 * (inkl. NOT NULL/CHECK/Partial-Unique). Verhinderte reale Fehlerfälle:
 *  - Spalten-/Naming-Drift zwischen Repo-SQL und Migration (liefe in D1 tot),
 *  - stillschweigend aufgeweichte Transfer-Bedingungen (banned/2FA/Doppel-Owner),
 *  - kaputte Single-use-/Partial-Unique-Semantik der Einladungen.
 */

const MIGRATIONS = [
  "0001_tenants.sql",
  "0002_auth.sql",
  "0003_branding.sql",
  "0004_two_factor_plugin_columns.sql",
] as const;

const T1 = "t_one";
const T2 = "t_two";

function seedUser(
  db: Database.Database,
  u: { id: string; tenantId: string; email: string; role: string; twoFactor?: boolean; banned?: boolean },
): void {
  db.prepare(
    `INSERT INTO auth_user (id, tenant_id, email, role, two_factor_enabled, banned)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(u.id, u.tenantId, u.email, u.role, u.twoFactor ? 1 : 0, u.banned ? 1 : 0);
}

function userRow(db: Database.Database, id: string) {
  return db
    .prepare("SELECT id, role, pending_role, two_factor_enabled, banned FROM auth_user WHERE id = ?")
    .get(id) as { role: string; pending_role: string | null } | undefined;
}

describe("Phase-D-Persistenz gegen die echten Migrationen (D1-Shim über better-sqlite3)", () => {
  let db: Database.Database;
  let d1: D1Database;

  beforeEach(() => {
    db = new Database(":memory:");
    applyMigrations(db, MIGRATIONS);
    db.prepare("INSERT INTO tenants (id, slug, name) VALUES (?, ?, ?)").run(T1, "one", "One");
    db.prepare("INSERT INTO tenants (id, slug, name) VALUES (?, ?, ?)").run(T2, "two", "Two");
    seedUser(db, { id: "owner1", tenantId: T1, email: "owner@one.test", role: "owner", twoFactor: true });
    seedUser(db, { id: "admin1", tenantId: T1, email: "admin@one.test", role: "admin", twoFactor: true });
    seedUser(db, { id: "content1", tenantId: T1, email: "content@one.test", role: "content", twoFactor: true });
    d1 = d1FromSqlite(db);
  });
  afterEach(() => db.close());

  describe("D1InvitationRepository", () => {
    it("Token nur composite (tenant_id, token_hash) auffindbar — fremder Tenant sieht NICHTS", async () => {
      const repo = new D1InvitationRepository(d1);
      const tokenHash = await hashInvitationToken("raw-token-abc");
      await repo.create({
        id: "inv1",
        tenantId: T1,
        email: "new@one.test",
        role: "content",
        tokenHash,
        inviterId: "admin1",
        expiresAt: 4102444800,
      });

      expect((await repo.findByTokenHash(T1, tokenHash))?.id).toBe("inv1");
      // Isolations-Invariante: gleiche Hash-Suche unter Tenant 2 → null.
      expect(await repo.findByTokenHash(T2, tokenHash)).toBeNull();
      expect(await repo.findById(T2, "inv1")).toBeNull();
      expect(await repo.listByTenant(T2)).toEqual([]);
    });

    it("uq_invitation_pending: zweite offene Einladung derselben E-Mail (andere Groß-/Kleinschreibung) wirft", async () => {
      const repo = new D1InvitationRepository(d1);
      const base = {
        tenantId: T1,
        role: "content" as const,
        inviterId: "admin1",
        expiresAt: 4102444800,
      };
      await repo.create({ ...base, id: "inv1", email: "dup@one.test", tokenHash: "h1" });
      await expect(
        repo.create({ ...base, id: "inv2", email: "DUP@one.test", tokenHash: "h2" }),
      ).rejects.toThrow();
      // Nach Revoke der ersten ist die E-Mail wieder frei (Partial-Unique).
      expect(await repo.markRevoked(T1, "inv1")).toBe(true);
      await repo.create({ ...base, id: "inv3", email: "dup@one.test", tokenHash: "h3" });
    });

    it("DB-CHECK verbietet role='owner' als Einladung (P-2, letzte Verteidigung hinter dem App-Check)", async () => {
      const repo = new D1InvitationRepository(d1);
      await expect(
        repo.create({
          id: "inv-owner",
          tenantId: T1,
          email: "evil@one.test",
          // App-seitig unmöglich (INVITE_ROLES); hier absichtlich am Typ vorbei.
          role: "owner" as never,
          tokenHash: "h-owner",
          inviterId: "admin1",
          expiresAt: 4102444800,
        }),
      ).rejects.toThrow();
    });

    it("markAccepted ist single-use (bedingtes UPDATE): erster Claim true, zweiter false; Revoke danach false", async () => {
      const repo = new D1InvitationRepository(d1);
      await repo.create({
        id: "inv1",
        tenantId: T1,
        email: "new@one.test",
        role: "content",
        tokenHash: "h1",
        inviterId: "admin1",
        expiresAt: 4102444800,
      });

      expect(await repo.markAccepted(T1, "inv1", "content1")).toBe(true);
      // Paralleler zweiter Accept verliert deterministisch:
      expect(await repo.markAccepted(T1, "inv1", "admin1")).toBe(false);
      expect(await repo.markRevoked(T1, "inv1")).toBe(false);
      expect((await repo.findById(T1, "inv1"))?.acceptedBy).toBe("content1");
    });
  });

  describe("D1TeamUserRepository.transferOwnership (kreuz-konditionierter Batch)", () => {
    it("happy path: demote+promote greifen beide, pending_role wird genullt", async () => {
      db.prepare("UPDATE auth_user SET pending_role = 'admin' WHERE id = 'admin1'").run();
      const repo = new D1TeamUserRepository(d1);

      expect(await repo.transferOwnership(T1, "owner1", "admin1")).toBe(true);
      expect(userRow(db, "owner1")?.role).toBe("admin");
      expect(userRow(db, "admin1")?.role).toBe("owner");
      expect(userRow(db, "admin1")?.pending_role).toBeNull();
    });

    it("gebanntes Ziel → false, DB unverändert (Regression: gebannter Account darf NIE owner werden)", async () => {
      seedUser(db, {
        id: "banned1",
        tenantId: T1,
        email: "banned@one.test",
        role: "admin",
        twoFactor: true,
        banned: true,
      });
      const repo = new D1TeamUserRepository(d1);

      expect(await repo.transferOwnership(T1, "owner1", "banned1")).toBe(false);
      expect(userRow(db, "owner1")?.role).toBe("owner");
      expect(userRow(db, "banned1")?.role).toBe("admin");
    });

    it("Ziel ohne TOTP / role=user / fremder Tenant → false, nichts partiell angewendet", async () => {
      seedUser(db, { id: "no2fa", tenantId: T1, email: "no2fa@one.test", role: "admin" });
      seedUser(db, { id: "plain", tenantId: T1, email: "plain@one.test", role: "user", twoFactor: true });
      seedUser(db, { id: "foreign", tenantId: T2, email: "f@two.test", role: "admin", twoFactor: true });
      const repo = new D1TeamUserRepository(d1);

      expect(await repo.transferOwnership(T1, "owner1", "no2fa")).toBe(false);
      expect(await repo.transferOwnership(T1, "owner1", "plain")).toBe(false);
      expect(await repo.transferOwnership(T1, "owner1", "foreign")).toBe(false);
      expect(userRow(db, "owner1")?.role).toBe("owner");
      expect(userRow(db, "no2fa")?.role).toBe("admin");
      expect(userRow(db, "plain")?.role).toBe("user");
      expect(userRow(db, "foreign")?.role).toBe("admin");
    });

    it("Doppel-Transfer-Race: der zweite Transfer desselben Ex-Owners → false (TOCTOU-Bedingungen im WHERE)", async () => {
      const repo = new D1TeamUserRepository(d1);
      expect(await repo.transferOwnership(T1, "owner1", "admin1")).toBe(true);
      // owner1 ist jetzt admin — dieselbe Aktion nochmal darf NICHT greifen.
      expect(await repo.transferOwnership(T1, "owner1", "content1")).toBe(false);
      expect(userRow(db, "admin1")?.role).toBe("owner");
      expect(userRow(db, "content1")?.role).toBe("content");
    });

    it("uq_user_tenant_owner (echte DDL): ein konstruierter zweiter Owner je Tenant wirft", () => {
      expect(() =>
        db.prepare("UPDATE auth_user SET role = 'owner' WHERE id = 'admin1'").run(),
      ).toThrow(/UNIQUE|unique/);
    });
  });

  describe("D1TeamUserRepository.revokeSessions / D1AuditRepository", () => {
    it("revokeSessions löscht NUR die Sessions des Users im Tenant", async () => {
      const insert = db.prepare(
        `INSERT INTO auth_session (id, tenant_id, user_id, token, expires_at)
         VALUES (?, ?, ?, ?, 4102444800)`,
      );
      insert.run("s1", T1, "owner1", "tok1");
      insert.run("s2", T1, "owner1", "tok2");
      insert.run("s3", T1, "admin1", "tok3");
      seedUser(db, { id: "u2", tenantId: T2, email: "u@two.test", role: "user" });
      insert.run("s4", T2, "u2", "tok4");

      await new D1TeamUserRepository(d1).revokeSessions(T1, "owner1");

      const left = db.prepare("SELECT id FROM auth_session ORDER BY id").all() as { id: string }[];
      expect(left.map((r) => r.id)).toEqual(["s3", "s4"]);
    });

    it("audit.append schreibt tenant-gebunden mit JSON-Metadata (und die DDL nimmt den Insert an)", async () => {
      await new D1AuditRepository(d1).append({
        tenantId: T1,
        actorId: "owner1",
        action: "ownership.transferred",
        targetId: "admin1",
        ipAddress: "203.0.113.7",
        userAgent: "vitest",
        metadata: { previousOwnerId: "owner1" },
      });

      const row = db
        .prepare("SELECT tenant_id, action, metadata FROM auth_audit_log")
        .get() as { tenant_id: string; action: string; metadata: string };
      expect(row.tenant_id).toBe(T1);
      expect(row.action).toBe("ownership.transferred");
      expect(JSON.parse(row.metadata)).toEqual({ previousOwnerId: "owner1" });
    });
  });
});
