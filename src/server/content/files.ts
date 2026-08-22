/**
 * DATEI-ANHÄNGE: Typ-Whitelist und Namens-Bereinigung.
 *
 * SICHERHEITSHALTUNG (bewusst eng): Erlaubt sind Dokumentformate, die ein
 * Hilfezentrum wirklich braucht — PDF, die Office-Formate (ZIP-Container),
 * sowie CSV/Text. NICHT erlaubt sind aktive Inhalte (HTML, SVG, JS) — die
 * würden vom selben Origin ausgeliefert und wären damit ein XSS-Vektor.
 * Zusätzlich liefert das Serving `content-disposition: attachment` und
 * `x-content-type-options: nosniff`, sodass auch Text nie als Seite rendert.
 *
 * Der Typ wird aus den BYTES gesniffed (nicht aus der Endung und nicht aus
 * dem vom Client geschickten content-type — beides ist frei fälschbar).
 */

export const ALLOWED_FILE_TYPES = {
  pdf: "application/pdf",
  csv: "text/csv",
  txt: "text/plain",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
} as const;

export type AllowedFileMime = (typeof ALLOWED_FILE_TYPES)[keyof typeof ALLOWED_FILE_TYPES];

/** 10 MB — großzügig für Formulare/Vorlagen, klein genug fürs Worker-Limit. */
export const MAX_FILE_BYTES = 10 * 1024 * 1024;
export const MAX_FILE_NAME_CHARS = 120;

const startsWith = (bytes: Uint8Array, sig: number[]): boolean =>
  sig.every((b, i) => bytes[i] === b);

/**
 * Erkennt den Typ anhand der Bytes und der (nur zur Unterscheidung der
 * ZIP-Container genutzten) Endung. `null` = nicht erlaubt.
 *
 * Office-Dateien sind alle ZIP (PK\x03\x04) und lassen sich ohne ZIP-Parser
 * nicht sicher auseinanderhalten; deshalb entscheidet hier die Endung, WELCHES
 * Office-Format es ist — dass es ein ZIP-Container ist, prüfen die Bytes.
 * Ein umbenanntes .zip landet damit höchstens als docx im Download, nie als
 * ausführbarer oder im Browser gerenderter Typ.
 */
export function sniffFileType(bytes: Uint8Array, fileName: string): AllowedFileMime | null {
  const ext = fileName.toLowerCase().split(".").pop() ?? "";

  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46])) return ALLOWED_FILE_TYPES.pdf; // %PDF
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) {
    if (ext === "docx") return ALLOWED_FILE_TYPES.docx;
    if (ext === "xlsx") return ALLOWED_FILE_TYPES.xlsx;
    if (ext === "pptx") return ALLOWED_FILE_TYPES.pptx;
    return null; // sonstige ZIPs bewusst nicht
  }
  if (ext === "csv" || ext === "txt") {
    // Textprüfung: keine Steuerzeichen außer Tab/CR/LF (das schließt Binär-
    // dateien mit harmloser Endung aus). Nur der Anfang wird geprüft.
    const probe = bytes.subarray(0, 4096);
    for (const b of probe) {
      if (b === 0x09 || b === 0x0a || b === 0x0d) continue;
      if (b < 0x20) return null;
    }
    return ext === "csv" ? ALLOWED_FILE_TYPES.csv : ALLOWED_FILE_TYPES.txt;
  }
  return null;
}

/**
 * Anzeige-/Download-Name: Pfadanteile und Steuerzeichen raus (kein
 * "../"-Ausbruch, keine Zeilenumbrüche im content-disposition-Header),
 * Anführungszeichen ersetzt, Länge begrenzt. Leer → "datei".
 */
export function sanitizeFileName(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? "";
  const clean = base
    .replace(/[\u0000-\u001f"]/g, "")
    .trim()
    .slice(0, MAX_FILE_NAME_CHARS);
  return clean.length > 0 ? clean : "datei";
}
