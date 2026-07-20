import { describe, expect, it } from "vitest";
import { otpauthQrDataUrl } from "./qr";

/**
 * Verhinderter Fehlerfall: das MFA-Setup zeigt einen kaputten/leeren QR-Code
 * (nicht scanbar) oder crasht beim Rendern — der QR ist der primäre Weg,
 * das TOTP-Secret in die Authenticator-App zu bekommen.
 */
describe("otpauthQrDataUrl", () => {
  it("liefert eine einbettbare SVG-Data-URL für eine echte otpauth-URI", () => {
    const url = otpauthQrDataUrl(
      "otpauth://totp/acme:owner%40firma.de?secret=JBSWY3DPEHPK3PXP&issuer=acme",
    );
    expect(url).toMatch(/^data:image\/svg\+xml;utf8,/);
    expect(decodeURIComponent(url!.split(",")[1])).toContain("<svg");
  });

  it("null/leer → null (Panel fällt auf manuellen Schlüssel zurück)", () => {
    expect(otpauthQrDataUrl(null)).toBeNull();
    expect(otpauthQrDataUrl("")).toBeNull();
  });
});
