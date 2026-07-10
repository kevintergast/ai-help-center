import { currentTenantIdOrThrow } from "./tenant-context";

/**
 * SESSION-TENANT-ENFORCEMENT (Aufgabe 3).
 *
 * Eine Session gilt AUSSCHLIESSLICH in ihrem eigenen Tenant. Der
 * `tenantAwareAdapter` erzwingt das bereits auf DB-Ebene (jeder Session-Read
 * wird per `tenantId == <ctx>` gescopet, ein Fremd-Token ist im falschen Tenant
 * schlicht unauffindbar). Diese Guards sind DEFENSE-IN-DEPTH für den Moment, in
 * dem ein Session-Objekt AUSSERHALB des Adapters in der Hand gehalten wird (z. B.
 * aus Cache, Header, weitergereicht) und erneut gegen den aktuellen Kontext
 * geprüft werden muss. Fail-closed: ohne Tenant-Kontext wird geworfen.
 */

/** Ein Session-artiges Objekt, das seine Tenant-Bindung selbst trägt. */
export interface TenantScopedSession {
  tenantId?: string | null;
}

export class SessionTenantMismatchError extends Error {
  constructor(expected: string, actual: string | null | undefined) {
    super(
      `Session gehört nicht zum aktuellen Tenant (fail-closed). ` +
        `Erwartet "${expected}", Session trägt "${actual ?? "<keine>"}".`,
    );
    this.name = "SessionTenantMismatchError";
  }
}

/**
 * Wirft, wenn die Session nicht zum aktuellen Tenant-Kontext gehört
 * (oder gar keine `tenantId` trägt, oder kein Kontext gesetzt ist).
 * @returns die unveränderte Session, wenn sie gültig ist (praktisch zum Verketten).
 */
export function assertSessionTenant<S extends TenantScopedSession>(session: S): S {
  const ctx = currentTenantIdOrThrow();
  if (session.tenantId !== ctx) {
    throw new SessionTenantMismatchError(ctx, session.tenantId);
  }
  return session;
}

/**
 * Weiche Variante: behandelt eine tenant-fremde/ungültige Session als
 * "keine Session" und gibt `null` zurück, statt zu werfen. Für Read-Pfade, die
 * eine ungültige Session einfach ignorieren sollen (kein 500, sondern anonym).
 */
export function enforceSessionTenant<S extends TenantScopedSession>(
  session: S | null | undefined,
): S | null {
  if (!session) return null;
  try {
    return assertSessionTenant(session);
  } catch {
    return null;
  }
}
