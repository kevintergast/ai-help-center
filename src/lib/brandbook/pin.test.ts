import { describe, expect, it } from "vitest";
import { checkPin, BRANDBOOK_PIN } from "./pin";

describe("checkPin", () => {
  it("akzeptiert den korrekten PIN", () => {
    expect(checkPin(BRANDBOOK_PIN)).toBe(true);
  });

  it("toleriert umgebenden Whitespace", () => {
    expect(checkPin(`  ${BRANDBOOK_PIN} `)).toBe(true);
  });

  it("lehnt falschen PIN ab", () => {
    expect(checkPin("0000")).toBe(false);
    expect(checkPin("147")).toBe(false);
    expect(checkPin("14790")).toBe(false);
  });

  it("lehnt leere Eingabe ab", () => {
    expect(checkPin("")).toBe(false);
    expect(checkPin("   ")).toBe(false);
  });
});
