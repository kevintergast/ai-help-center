import type { AuthInstance } from "@/server/api/context";

/**
 * ROLLEN-VERWALTUNG (Phase C, M-2): Team-Zielrolle PARKEN statt vergeben.
 *
 * Eine Team-Rolle (`content`/`admin`) wird NIE direkt auf `user.role` gesetzt,
 * solange das TOTP-Enrollment nicht abgeschlossen ist. Stattdessen parkt sie in
 * `user.pendingRole`; die Promotion `role = pendingRole` passiert ausschließlich
 * im `verifyTotp`-Erfolgspfad (mfa-policy.ts / mfaUserUpdateAfter) — atomar,
 * tenant-scoped, nur wenn `twoFactorEnabled` wirklich true wurde.
 *
 * Aufrufer (kommende Invite-Flows, Phase D) MÜSSEN im Tenant-Kontext laufen
 * (`runWithTenant`), sonst wirft der tenantAwareAdapter fail-closed.
 * `owner` ist hier bewusst NICHT vergebbar (nur Transfer-Flow, §c.6).
 */

export type PendingRole = "content" | "admin";

const PENDING_ROLES: ReadonlySet<string> = new Set(["content", "admin"]);

/**
 * Parkt die Zielrolle in `pendingRole`. Wirft bei unzulässiger Rolle
 * (fail-closed, kein stilles Ignorieren) oder wenn der User im aktuellen
 * Tenant nicht existiert.
 */
export async function setPendingRole(
  auth: AuthInstance,
  userId: string,
  role: PendingRole,
): Promise<void> {
  if (!PENDING_ROLES.has(role)) {
    throw new Error(`setPendingRole: unzulässige Zielrolle "${role}" (nur content|admin)`);
  }
  const ctx = await auth.$context;
  const updated = await ctx.adapter.update({
    model: "user",
    where: [{ field: "id", value: userId }],
    update: { pendingRole: role },
  });
  if (!updated) {
    throw new Error("setPendingRole: User im aktuellen Tenant nicht gefunden (fail-closed)");
  }
}
