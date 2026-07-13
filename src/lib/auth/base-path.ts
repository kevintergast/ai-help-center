/**
 * HTTP-Mount-Pfad der Auth-Endpunkte, client-sicher dupliziert.
 *
 * Der maßgebliche Wert lebt serverseitig in `src/server/auth/auth.ts`
 * (`AUTH_BASE_PATH`). Er wird hier bewusst NICHT importiert, weil dieses Modul
 * in Client-Komponenten (auth-client.ts) landet und `auth.ts` die
 * betterAuth-Server-/Adapter-Kette mitzieht. Beide Konstanten müssen identisch
 * bleiben; ein Test (`base-path.test.ts`) verankert die Gleichheit, damit ein
 * Drift sofort auffällt.
 */
export const AUTH_BASE_PATH = "/api/v1/auth";
