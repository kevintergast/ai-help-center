import { describe, expect, it } from "vitest";
import { ALLOWED_FILE_TYPES, sanitizeFileName, sniffFileType } from "./files";

/**
 * Verhinderte Fehlerfälle:
 *  - Eine HTML-/SVG-Datei kommt als Anhang durch und wird vom EIGENEN Origin
 *    ausgeliefert → gespeichertes XSS im Hilfezentrum eines Kunden.
 *  - Endung entscheidet über den Typ (umbenannte .exe als „PDF").
 *  - Dateiname mit Zeilenumbruch/Anführungszeichen landet im
 *    content-disposition-Header → Header-Injection.
 *  - Pfadanteile im Namen ("../../etc/passwd") wandern in den Download-Namen.
 */

const bytes = (...b: number[]) => new Uint8Array(b);
const text = (s: string) => new TextEncoder().encode(s);
const PDF = bytes(0x25, 0x50, 0x44, 0x46, 0x2d, 0x31);
const ZIP = bytes(0x50, 0x4b, 0x03, 0x04, 0x14, 0x00);

describe("sniffFileType", () => {
  it("erkennt PDF an den Bytes (Endung irrelevant)", () => {
    expect(sniffFileType(PDF, "anleitung.pdf")).toBe(ALLOWED_FILE_TYPES.pdf);
    expect(sniffFileType(PDF, "anleitung.txt")).toBe(ALLOWED_FILE_TYPES.pdf);
  });

  it("ordnet ZIP-Container nur den Office-Endungen zu", () => {
    expect(sniffFileType(ZIP, "vorlage.docx")).toBe(ALLOWED_FILE_TYPES.docx);
    expect(sniffFileType(ZIP, "tabelle.xlsx")).toBe(ALLOWED_FILE_TYPES.xlsx);
    expect(sniffFileType(ZIP, "folien.pptx")).toBe(ALLOWED_FILE_TYPES.pptx);
    // Rohes ZIP bleibt abgelehnt (Container mit beliebigem Inhalt).
    expect(sniffFileType(ZIP, "archiv.zip")).toBeNull();
  });

  it("nimmt CSV/TXT nur, wenn es wirklich Text ist", () => {
    expect(sniffFileType(text("a;b\n1;2\n"), "daten.csv")).toBe(ALLOWED_FILE_TYPES.csv);
    expect(sniffFileType(text("Hallo\tWelt\r\n"), "notiz.txt")).toBe(ALLOWED_FILE_TYPES.txt);
    // Binärdatei mit harmloser Endung (NUL-Byte) → abgelehnt.
    expect(sniffFileType(bytes(0x00, 0x01, 0x02), "daten.csv")).toBeNull();
  });

  it("lehnt aktive Inhalte ab (XSS-Vektor im eigenen Origin)", () => {
    expect(sniffFileType(text("<html><script>alert(1)</script>"), "seite.html")).toBeNull();
    expect(sniffFileType(text("<svg onload=alert(1)>"), "bild.svg")).toBeNull();
    expect(sniffFileType(text("alert(1)"), "code.js")).toBeNull();
    expect(sniffFileType(bytes(0x4d, 0x5a, 0x90), "setup.exe")).toBeNull();
    expect(sniffFileType(PDF, "ohne-endung")).toBe(ALLOWED_FILE_TYPES.pdf); // Bytes gewinnen
    expect(sniffFileType(text("nur text"), "ohne-endung")).toBeNull();
  });
});

describe("sanitizeFileName", () => {
  it("behält lesbare Namen inklusive Leerzeichen und Umlauten", () => {
    expect(sanitizeFileName("Checkliste Onboarding (V2).pdf")).toBe("Checkliste Onboarding (V2).pdf");
    expect(sanitizeFileName("Prüfprotokoll.xlsx")).toBe("Prüfprotokoll.xlsx");
  });

  it("entfernt Pfadanteile", () => {
    expect(sanitizeFileName("../../etc/passwd")).toBe("passwd");
    expect(sanitizeFileName("C:\\Temp\\vorlage.docx")).toBe("vorlage.docx");
  });

  it("entfernt Header-gefährliche Zeichen", () => {
    expect(sanitizeFileName('datei".pdf')).toBe("datei.pdf");
    expect(sanitizeFileName("zeile\r\numbruch.pdf")).toBe("zeileumbruch.pdf");
  });

  it("fällt auf einen Namen zurück statt leer zu bleiben", () => {
    expect(sanitizeFileName("")).toBe("datei");
    expect(sanitizeFileName("///")).toBe("datei");
  });
});
