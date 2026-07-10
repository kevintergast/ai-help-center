/**
 * ROLLENMODELL (Phase B): lineare Team-Hierarchie user < content < admin < owner.
 *
 * Fail-closed: `rank` liefert für JEDEN unbekannten/fehlenden Rollen-String
 * `Number.NEGATIVE_INFINITY` — ein manipulierter oder zukünftiger Rollenwert
 * kann damit NIE eine Mindestanforderung erfüllen (`-Infinity >= x` ist für
 * jede endliche Schwelle false).
 */

export type Role = "user" | "content" | "admin" | "owner";

/** Team-Rollen = alles oberhalb von "user" (Mindestanforderung für Guards). */
export type TeamRole = Exclude<Role, "user">;

const RANKS: Readonly<Record<Role, number>> = {
  user: 0,
  content: 1,
  admin: 2,
  owner: 3,
};

/**
 * Numerischer Rang einer Rolle. Unbekannte Rolle → `Number.NEGATIVE_INFINITY`
 * (fail-closed, niemals 0 oder ein anderer "harmloser" Default).
 */
export function rank(role: string): number {
  return Object.prototype.hasOwnProperty.call(RANKS, role)
    ? RANKS[role as Role]
    : Number.NEGATIVE_INFINITY;
}

/**
 * Erfüllt `role` mindestens `min`? Fehlende/unbekannte Rolle → false.
 */
export function hasAtLeast(role: string | null | undefined, min: Role): boolean {
  if (typeof role !== "string") return false;
  return rank(role) >= rank(min);
}
