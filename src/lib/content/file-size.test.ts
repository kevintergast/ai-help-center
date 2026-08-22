import { describe, expect, it } from "vitest";
import { formatFileSize } from "./file-size";

/**
 * Verhinderter Fehlerfall (live gesehen): eine 96-Byte-Vorlage wurde als
 * "0 KB" angezeigt — das liest sich wie eine kaputte Datei.
 */
describe("formatFileSize", () => {
  it("rundet unter 1 KB auf 1 KB auf (nie 0 KB)", () => {
    expect(formatFileSize(96, "de")).toBe("1 KB");
    expect(formatFileSize(0, "de")).toBe("1 KB");
  });

  it("KB und MB mit Locale-Dezimaltrenner", () => {
    expect(formatFileSize(840 * 1024, "de")).toBe("840 KB");
    expect(formatFileSize(Math.round(1.25 * 1024 * 1024), "de")).toBe("1,3 MB");
    expect(formatFileSize(Math.round(1.25 * 1024 * 1024), "en")).toBe("1.3 MB");
  });
});
