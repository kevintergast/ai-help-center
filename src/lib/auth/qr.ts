import { renderSVG } from "uqr";

/**
 * QR-CODE fürs TOTP-Enrollment: rendert die otpauth-URI als SVG-Data-URL für
 * ein normales `<img src>` — bewusst KEIN dangerouslySetInnerHTML (Projekt-
 * Grundsatz, s. SimpleMarkdown) und keine externe Bild-URL (das Secret bleibt
 * im Browser). uqr ist dependency-frei und läuft im Client-Bundle.
 */
export function otpauthQrDataUrl(uri: string | null): string | null {
  if (!uri) return null;
  try {
    return `data:image/svg+xml;utf8,${encodeURIComponent(renderSVG(uri))}`;
  } catch {
    // Unrenderbarer Inhalt → kein QR; das Panel zeigt weiterhin den
    // manuellen Schlüssel + otpauth-Link (QR ist Komfort, kein Gate).
    return null;
  }
}
