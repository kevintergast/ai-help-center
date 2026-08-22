/**
 * Dateigrößen-Label für Datei-Anhänge (0029).
 *
 * „1,2 MB" / „840 KB" — Einheit sprachneutral, Dezimaltrenner nach Locale.
 * Unter 1 KB wird auf „1 KB" aufgerundet: „0 KB" liest sich wie ein Fehler
 * (kleine Vorlagen sind real, z. B. eine CSV mit drei Zeilen).
 */
export function formatFileSize(bytes: number, locale: string): string {
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 1 }).format(mb)} MB`;
  const kb = Math.max(1, Math.round(bytes / 1024));
  return `${new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(kb)} KB`;
}
