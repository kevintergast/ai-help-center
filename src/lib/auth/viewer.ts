/**
 * Angemeldeter Betrachter des Hilfezentrums (Endnutzer-Shell) — bewusst nur
 * die Anzeige-Essenz der Session. Serverseitig gelesen (page-guard.ts,
 * readPageViewer) und als Prop in die Client-Shell gereicht; NIE aus
 * Client-State geraten.
 */
export interface HelpViewer {
  name: string | null;
  email: string;
  /** user | content | admin | owner — steuert nur UI-Links (Guards bleiben serverseitig). */
  role: string;
}

/** Team-Rollen sehen den Admin-Bereich-Link (Server-Gates prüfen unabhängig). */
export function isTeamRole(role: string): boolean {
  return role === "content" || role === "admin" || role === "owner";
}
