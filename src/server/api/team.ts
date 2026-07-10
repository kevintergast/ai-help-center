import { Hono } from "hono";
import type { Context } from "hono";
import { rank } from "@/server/auth/access-control";
import type { AuditAction } from "@/server/auth/audit";
import { canonicalizeEmail } from "@/server/auth/email";
import { requireFreshMfa, requireOwner, requireTeam } from "@/server/auth/guards";
import {
  INVITATION_TTL_SEC,
  generateInvitationToken,
  hashInvitationToken,
  type InvitationRecord,
  type InvitationRole,
} from "@/server/auth/invitations";
import { setPendingRole } from "@/server/auth/roles";
import { tenantBaseURL } from "@/server/auth/runtime";
import { enforceSessionTenant } from "@/server/auth/session-guard";
import type { ApiDeps, ApiEnv, TeamDeps } from "./context";

/**
 * TEAM-ROUTEN (Phase D): Einladungen (§c.4) + Ownership-Transfer (§c.6).
 *
 * ENDPUNKTE
 *   POST   /admin/invitations          requireTeam("admin")  — einladen
 *   GET    /admin/invitations          requireTeam("admin")  — Liste (ohne Hash)
 *   DELETE /admin/invitations/:id      requireTeam("admin")  — revoken
 *   POST   /invitations/accept         Session-Pflicht (Default-Deny), KEIN Team-Gate
 *   POST   /admin/ownership/transfer   requireOwner + requireFreshMfa(300)
 *
 * SICHERHEITSENTSCHEIDUNGEN (Design-Abgleich, dokumentiert):
 *
 *  - ROLLEN-DECKEL (D3/P-2): rank(actor) MUSS STRIKT > rank(invite.role) sein —
 *    admin lädt nur content ein, admin-Einladungen sind owner-exklusiv, owner
 *    ist nie einladbar (App-Check ZUSÄTZLICH zum DB-CHECK content|admin).
 *    Beim REVOKE gilt derselbe Deckel (admin revoked nur content-Invites).
 *
 *  - RE-INVITE (§c.4.1 / uq_invitation_pending): eine bereits offene Einladung
 *    je (tenant, kanonisierte E-Mail) wird beim erneuten Einladen STORNIERT und
 *    durch die neue ersetzt — sofern der Actor die alte revoken DÜRFTE
 *    (Rollen-Deckel!). Darf er nicht (admin vs. offene admin-Einladung des
 *    owners), antwortet die Route 409 invitation_pending statt fremde
 *    owner-Einladungen zu entwerten.
 *
 *  - TOKEN: Antwort enthält NIE das Token (nur id/status/expiry) — es existiert
 *    ausschließlich im Mail-Link. DEV-AUSNAHME `devAcceptUrl`: ist KEIN
 *    RESEND_API_KEY konfiguriert (sendInvitationEmail → false, No-op) UND
 *    läuft der Prozess NICHT in Produktion (NODE_ENV), gibt die Route den
 *    Accept-Link zurück — sonst könnte in dev/Tests niemand einladen.
 *    FAIL-CLOSED in Produktion: `!sent` in Prod ist eine Misskonfiguration
 *    (Key fehlt/rotiert) — die Einladung wird storniert und die Route
 *    antwortet 503 invitation_email_unconfigured; ein Token darf dort NIE in
 *    einer API-Antwort (oder Client-Logs/Proxies) landen. Ein echter
 *    Zustellfehler (Key gesetzt, Resend != 2xx) storniert die Einladung
 *    ebenfalls → 502 (keine unzustellbaren Zombie-Invites).
 *
 *  - ACCEPT: Session-Pflicht über die Default-Deny-Middleware (kein
 *    public-routes-Eintrag!), aber bewusst KEIN Team-Gate — der Annehmende ist
 *    ein normaler user. Nicht-lesbare Tokens (fremder Tenant, unbekannt,
 *    bereits accepted/revoked) antworten EINHEITLICH 404 invitation_not_found
 *    (kein Existenz-Orakel). Ablauf wird beim Accept-Versuch persistiert
 *    (status=expired) → 410. E-Mail-Bindung (A-5): emailVerified UND
 *    kanonischer E-Mail-Gleichstand, sonst 403 email_mismatch (EIN Code für
 *    beide Fälle — kein Orakel, welcher Check scheiterte).
 *
 *  - ALREADY_TEAM_MEMBER (Entscheidung, Design §c.4.3 „Raise-only"): hat der
 *    Annehmende (aktiv ODER geparkt) bereits eine Rolle >= invite.role, wird
 *    die Rolle NIE gesenkt. Die Einladung wird dabei als ACCEPTED-NOOP
 *    konsumiert (single-use; pending bliebe sonst via Partial-Unique ein
 *    Blocker für künftige Re-Invites dieser E-Mail), Antwort 409
 *    already_team_member.
 *
 *  - KEIN SESSION-REVOKE beim Accept (§e-Abgleich): pending_role verleiht noch
 *    NICHTS — die effektive Rollen-Änderung passiert erst bei der Promotion
 *    nach TOTP-Enrollment (mfa-policy.ts, mfaUserUpdateAfter), und GENAU dort
 *    werden die anderen Sessions bereits widerrufen (§e „Rollen-Änderung →
 *    revokeSessions"). Ein Revoke hier wäre doppelt und würde den frisch
 *    Eingeladenen nur aus dem Enrollment werfen.
 *
 *  - TRANSFER (§c.6): requireOwner + requireFreshMfa(300) (erster echter
 *    Einsatz des Step-up-Guards, M-5). Die eigentliche Zustandsänderung ist
 *    ein kreuz-konditionierter D1-batch (team-users.ts) — TOCTOU-sicher, kein
 *    partielles Anwenden möglich; die Vorab-Checks hier liefern nur PRÄZISERE
 *    Fehlercodes (404/409), autoritativ sind die WHERE-Bedingungen im Batch.
 *    Danach Session-Revoke BEIDER User + Audit ownership.transferred.
 *
 *  - AUDIT (§f): non-blocking — ein Audit-Fehler bricht die fachliche Aktion
 *    nicht ab (console.error ohne Secrets); Tests injizieren einen Fake und
 *    sehen jeden Eintrag. metadata NIE mit Token/Secrets.
 */

const TEAM_UNAVAILABLE = { error: "team_unavailable" } as const;
const UNAUTHORIZED = { error: "unauthorized" } as const;
const INVITATION_NOT_FOUND = { error: "invitation_not_found" } as const;

const INVITE_ROLES: ReadonlySet<string> = new Set(["content", "admin"]);

function nowEpochSec(): number {
  return Math.floor(Date.now() / 1000);
}

/** User-Auszug der Session, wie ihn die Team-Routen brauchen. */
interface SessionUser {
  id: string;
  email: string;
  emailVerified?: boolean | null;
  role?: string | null;
  pendingRole?: string | null;
}

interface TeamSessionData {
  session: { tenantId?: string | null };
  user: SessionUser;
}

/**
 * Session-User nach den Guards erneut lesen (die Guards reichen keine Daten
 * weiter). Fail-closed: Fehler/fremder Tenant → null (Route antwortet 401).
 */
async function readSessionUser(c: Context<ApiEnv>): Promise<SessionUser | null> {
  try {
    const auth = await c.get("getAuth")();
    const data = (await auth.api.getSession({
      headers: c.req.raw.headers,
    })) as TeamSessionData | null;
    if (!data || !enforceSessionTenant(data.session)) return null;
    return data.user;
  } catch {
    return null;
  }
}

/** Audit non-blocking: Fehler loggen (ohne Secrets), Aktion nie abbrechen. */
async function audit(
  team: TeamDeps,
  c: Context<ApiEnv>,
  event: {
    actorId: string | null;
    action: AuditAction;
    targetId?: string | null;
    metadata?: Record<string, unknown> | null;
  },
): Promise<void> {
  try {
    await team.audit.append({
      tenantId: c.get("tenant").id,
      ipAddress: c.req.header("cf-connecting-ip") ?? null,
      userAgent: c.req.header("user-agent") ?? null,
      ...event,
    });
  } catch (err) {
    console.error("[api/team] audit append failed:", err);
  }
}

/** Öffentliche Projektion (ohne token_hash — der verlässt die Persistenz nie). */
function toApiInvitation(inv: InvitationRecord) {
  return {
    id: inv.id,
    email: inv.email,
    role: inv.role,
    status: inv.status,
    expiresAt: inv.expiresAt,
    createdAt: inv.createdAt,
    inviterId: inv.inviterId,
    acceptedBy: inv.acceptedBy,
  };
}

export function invitationsAdminRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  r.post("/", requireTeam("admin"), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const raw = body as { email?: unknown; role?: unknown };
    if (typeof raw.email !== "string" || !raw.email.includes("@") || raw.email.length > 254) {
      return c.json({ error: "invalid_email" }, 400);
    }
    // owner ist NIE einladbar; alles außerhalb content|admin ist ungültig
    // (App-Check zusätzlich zum DB-CHECK der Migration).
    if (typeof raw.role !== "string" || !INVITE_ROLES.has(raw.role)) {
      return c.json({ error: "invalid_role" }, 400);
    }
    const role = raw.role as InvitationRole;
    const email = canonicalizeEmail(raw.email);

    const team = await deps.getTeamDeps();
    if (!team) return c.json(TEAM_UNAVAILABLE, 503);

    const actor = await readSessionUser(c);
    if (!actor) return c.json(UNAUTHORIZED, 401);

    // ROLLEN-DECKEL (strikt >): admin darf nur content; admin-Invites sind
    // owner-exklusiv.
    if (!(rank(actor.role ?? "") > rank(role))) {
      return c.json({ error: "role_not_allowed" }, 403);
    }

    const tenant = c.get("tenant");

    // RE-INVITE-Semantik (siehe Kopfkommentar): offene Einladung derselben
    // E-Mail wird storniert und ersetzt — sofern der Actor sie revoken dürfte.
    const existing = await team.invitations.findPendingByEmail(tenant.id, email);
    if (existing) {
      if (!(rank(actor.role ?? "") > rank(existing.role))) {
        return c.json({ error: "invitation_pending" }, 409);
      }
      const revoked = await team.invitations.markRevoked(tenant.id, existing.id);
      if (!revoked) return c.json({ error: "invitation_pending" }, 409);
      await audit(team, c, {
        actorId: actor.id,
        action: "invitation.revoked",
        targetId: existing.id,
        metadata: { role: existing.role, reason: "replaced_by_reinvite" },
      });
    }

    const token = generateInvitationToken();
    const invitation = {
      id: crypto.randomUUID(),
      tenantId: tenant.id,
      email,
      role,
      tokenHash: await hashInvitationToken(token),
      inviterId: actor.id,
      expiresAt: nowEpochSec() + INVITATION_TTL_SEC[role],
    };
    await team.invitations.create(invitation);

    // Accept-Link auf dem KANONISCHEN Tenant-Host (§c.4.2) — Token nur hier.
    const acceptUrl = `${tenantBaseURL(tenant)}/invite/accept?token=${token}`;

    let sent: boolean;
    try {
      sent = await team.sendInvitationEmail({
        to: email,
        acceptUrl,
        role,
        tenantName: tenant.name,
      });
    } catch (err) {
      // Echter Zustellfehler (Key gesetzt, Versand scheitert): Einladung
      // stornieren — keine Zombie-Invites, deren Token niemand je erhielt.
      await team.invitations.markRevoked(tenant.id, invitation.id);
      console.error("[api/team] invitation email failed:", err);
      return c.json({ error: "invitation_email_failed" }, 502);
    }

    // FAIL-CLOSED (Kopfkommentar TOKEN): `!sent` in Produktion = Versand nicht
    // konfiguriert → Einladung stornieren + 503. NIE das Token ausgeben.
    if (!sent && process.env.NODE_ENV === "production") {
      await team.invitations.markRevoked(tenant.id, invitation.id);
      console.error(
        "[api/team] invitation email unconfigured (RESEND_API_KEY fehlt) — fail-closed, Einladung storniert.",
      );
      return c.json({ error: "invitation_email_unconfigured" }, 503);
    }

    await audit(team, c, {
      actorId: actor.id,
      action: "invitation.created",
      targetId: invitation.id,
      metadata: { role, email },
    });

    return c.json(
      {
        id: invitation.id,
        email,
        role,
        status: "pending",
        expiresAt: invitation.expiresAt,
        // DEV-ONLY (kein RESEND_API_KEY → No-op-Versand, NODE_ENV != prod):
        // Accept-Link im Response. In Produktion existiert das Feld NIE —
        // `!sent` wurde dort oben bereits fail-closed mit 503 beantwortet.
        ...(sent ? {} : { devAcceptUrl: acceptUrl }),
      },
      201,
    );
  });

  r.get("/", requireTeam("admin"), async (c) => {
    const team = await deps.getTeamDeps();
    if (!team) return c.json(TEAM_UNAVAILABLE, 503);
    const invitations = await team.invitations.listByTenant(c.get("tenant").id);
    return c.json({ invitations: invitations.map(toApiInvitation) });
  });

  r.delete("/:id", requireTeam("admin"), async (c) => {
    const team = await deps.getTeamDeps();
    if (!team) return c.json(TEAM_UNAVAILABLE, 503);

    const actor = await readSessionUser(c);
    if (!actor) return c.json(UNAUTHORIZED, 401);

    const tenantId = c.get("tenant").id;
    const id = c.req.param("id");
    if (!id) return c.json(INVITATION_NOT_FOUND, 404);
    const invitation = await team.invitations.findById(tenantId, id);
    if (!invitation) return c.json(INVITATION_NOT_FOUND, 404);

    // Revoke-Deckel analog CREATE: admin darf nur content-Invites revoken.
    if (!(rank(actor.role ?? "") > rank(invitation.role))) {
      return c.json({ error: "role_not_allowed" }, 403);
    }

    const revoked = await team.invitations.markRevoked(tenantId, invitation.id);
    if (!revoked) return c.json({ error: "invitation_not_pending" }, 409);

    await audit(team, c, {
      actorId: actor.id,
      action: "invitation.revoked",
      targetId: invitation.id,
      metadata: { role: invitation.role },
    });
    return c.json({ ok: true });
  });

  return r;
}

export function invitationsAcceptRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  // Session-Pflicht kommt aus der Default-Deny-Middleware (KEIN public-Eintrag,
  // KEIN Team-Gate — der Annehmende ist ein normaler eingeloggter user).
  r.post("/accept", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const token = (body as { token?: unknown }).token;
    if (typeof token !== "string" || token.length < 16 || token.length > 512) {
      return c.json({ error: "invalid_token" }, 400);
    }

    const team = await deps.getTeamDeps();
    if (!team) return c.json(TEAM_UNAVAILABLE, 503);

    const user = await readSessionUser(c);
    if (!user) return c.json(UNAUTHORIZED, 401);

    const tenantId = c.get("tenant").id;

    // Lookup AUSSCHLIESSLICH composite (tenant_id, sha256(token)) — ein Token
    // aus einem fremden Tenant ist hier schlicht unauffindbar (T-4, kein Leak).
    const invitation = await team.invitations.findByTokenHash(
      tenantId,
      await hashInvitationToken(token),
    );
    // Einheitlich 404 für alles Nicht-Einlösbare (unbekannt, accepted, revoked,
    // expired-status) — kein Existenz-/Status-Orakel für Token-Rater.
    if (!invitation || invitation.status !== "pending") {
      return c.json(INVITATION_NOT_FOUND, 404);
    }

    if (invitation.expiresAt <= nowEpochSec()) {
      // Ablauf persistieren (pending → expired), dann 410.
      await team.invitations.markExpired(tenantId, invitation.id);
      await audit(team, c, {
        actorId: user.id,
        action: "invitation.expired",
        targetId: invitation.id,
        metadata: { role: invitation.role },
      });
      return c.json({ error: "invitation_expired" }, 410);
    }

    // Identitäts-Invariante (A-5): verifizierte E-Mail UND kanonischer
    // Gleichstand mit der eingeladenen Adresse — EIN Fehlercode für beide
    // Fälle (kein Orakel, welcher Check scheiterte).
    if (user.emailVerified !== true || canonicalizeEmail(user.email) !== invitation.email) {
      return c.json({ error: "email_mismatch" }, 403);
    }

    // Gebannte Konten (Notbremse §b) können nichts annehmen — fail-closed,
    // die Einladung bleibt unkonsumiert. Nach der E-Mail-Bindung geprüft
    // (nur der legitime Adressat erreicht diesen Punkt, kein neues Orakel).
    const acceptor = await team.users.findById(tenantId, user.id);
    if (!acceptor || acceptor.banned) {
      return c.json({ error: "forbidden" }, 403);
    }

    // Rollen-Deckel ERNEUT prüfen (P-2): Inviter existiert noch, ist nicht
    // gebannt und steht STRIKT über der Invite-Rolle.
    const inviter = await team.users.findById(tenantId, invitation.inviterId);
    if (!inviter || inviter.banned || !(rank(inviter.role) > rank(invitation.role))) {
      return c.json({ error: "invitation_role_conflict" }, 409);
    }

    // Raise-only (§c.4.3): aktive ODER geparkte Rolle >= Zielrolle → nie
    // senken. Die Einladung wird dabei als accepted-noop KONSUMIERT
    // (single-use; pending bliebe sonst ein Partial-Unique-Blocker).
    const effectiveRank = Math.max(rank(user.role ?? ""), rank(user.pendingRole ?? ""));
    if (effectiveRank >= rank(invitation.role)) {
      const consumed = await team.invitations.markAccepted(tenantId, invitation.id, user.id);
      if (consumed) {
        await audit(team, c, {
          actorId: user.id,
          action: "invitation.accepted",
          targetId: invitation.id,
          metadata: { role: invitation.role, noop: true },
        });
      }
      return c.json({ error: "already_team_member" }, 409);
    }

    // Single-use ATOMAR beanspruchen (bedingtes UPDATE, kein TOCTOU): schlägt
    // das fehl, hat ein paralleler Accept gewonnen → wie „nicht (mehr) da".
    const claimed = await team.invitations.markAccepted(tenantId, invitation.id, user.id);
    if (!claimed) return c.json(INVITATION_NOT_FOUND, 404);

    // Zielrolle PARKEN (M-2) — NIE role direkt. Die Promotion role=pending_role
    // macht mfa-policy.ts nach vollständigem TOTP-Enrollment automatisch und
    // widerruft DORT die anderen Sessions (§e) — deshalb hier KEIN Revoke.
    const auth = await c.get("getAuth")();
    await setPendingRole(auth, user.id, invitation.role);

    await audit(team, c, {
      actorId: user.id,
      action: "invitation.accepted",
      targetId: invitation.id,
      metadata: { role: invitation.role },
    });

    return c.json({ ok: true, role: invitation.role, pendingMfaEnrollment: true });
  });

  return r;
}

export function ownershipRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  // §c.6: owner-exklusiv + FRISCHES TOTP-Step-up (erster echter Einsatz von
  // requireFreshMfa; 300 s = STEP_UP_MAX_AGE_SEC).
  r.post("/transfer", requireOwner, requireFreshMfa(300), async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const targetUserId = (body as { targetUserId?: unknown }).targetUserId;
    if (typeof targetUserId !== "string" || !targetUserId) {
      return c.json({ error: "invalid_target" }, 400);
    }

    const team = await deps.getTeamDeps();
    if (!team) return c.json(TEAM_UNAVAILABLE, 503);

    const actor = await readSessionUser(c);
    if (!actor) return c.json(UNAUTHORIZED, 401);
    if (targetUserId === actor.id) return c.json({ error: "invalid_target" }, 400);

    const tenantId = c.get("tenant").id;

    // Vorab-Checks NUR für präzise Fehlercodes — autoritativ (TOCTOU-sicher)
    // sind die WHERE-Bedingungen im batch (team-users.ts).
    const target = await team.users.findById(tenantId, targetUserId);
    if (!target) return c.json({ error: "user_not_found" }, 404);
    if (target.role !== "admin" && target.role !== "content") {
      return c.json({ error: "invalid_target_role" }, 409);
    }
    // Ein gebanntes Konto (Notbremse §b) darf NIE owner werden — sonst gehörte
    // die Instanz einem gesperrten Account. Autoritativ steht `banned = 0`
    // zusätzlich in den WHERE-Bedingungen des Batches (team-users.ts).
    if (target.banned) {
      return c.json({ error: "target_banned" }, 409);
    }
    if (!target.twoFactorEnabled) {
      return c.json({ error: "target_mfa_required" }, 409);
    }

    const transferred = await team.users.transferOwnership(tenantId, actor.id, target.id);
    if (!transferred) return c.json({ error: "transfer_conflict" }, 409);

    // §e: Sessions BEIDER Beteiligten widerrufen (auch die des Aufrufers —
    // diese Antwort ist seine letzte Aktion mit der alten Session).
    await team.users.revokeSessions(tenantId, actor.id);
    await team.users.revokeSessions(tenantId, target.id);

    await audit(team, c, {
      actorId: actor.id,
      action: "ownership.transferred",
      targetId: target.id,
      metadata: { previousOwnerId: actor.id },
    });

    return c.json({ ok: true });
  });

  return r;
}
