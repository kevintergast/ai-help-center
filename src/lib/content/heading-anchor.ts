/**
 * ANKER-IDS für Überschriften („Abschnitt teilen"): aus dem Überschriftentext
 * abgeleitet, damit Links STABIL bleiben — ein zusätzlicher Absatz oder eine
 * verschobene Überschrift ändert die Id nicht (eine Positions-Nummerierung
 * würde geteilte Links reihenweise brechen).
 *
 * Kollisionen (zwei gleich benannte Überschriften) löst `withSuffix`: die
 * zweite bekommt `-2`. Deterministisch — gleiche Reihenfolge, gleiche Ids.
 */
export function headingAnchorId(text: string): string {
  const base = text
    .toLowerCase()
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  // Rein nicht-lateinische Überschriften (z. B. kyrillisch) fallen sonst auf
  // einen leeren String zurück — dann bliebe die Sprungmarke unbrauchbar.
  return base.length > 0 ? base : "abschnitt";
}

/** Vergibt eindeutige Ids in Dokumentreihenfolge (`-2`, `-3` bei Dubletten). */
export function uniqueAnchorId(text: string, taken: Set<string>): string {
  const base = headingAnchorId(text);
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  taken.add(id);
  return id;
}
