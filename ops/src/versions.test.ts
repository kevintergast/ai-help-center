import { describe, expect, it, vi } from "vitest";
import { buildAge, compareVersions, fetchDeployment, releasePending } from "./versions";

/**
 * Verhinderte Fehlerfälle:
 *  - Eine nicht erreichbare Umgebung wird als „aktuell" angezeigt (das
 *    Dashboard darf nie eine Version behaupten, die es nicht gelesen hat).
 *  - "unknown" gilt als neuer als eine echte Version → der Hinweis „Release
 *    wartet" erscheint falsch oder fehlt.
 */

describe("compareVersions", () => {
  it("vergleicht nach SemVer-Stellen", () => {
    expect(compareVersions("0.2.0", "0.1.9")).toBe(1);
    expect(compareVersions("0.1.9", "0.2.0")).toBe(-1);
    expect(compareVersions("1.0.0", "1.0.0")).toBe(0);
    expect(compareVersions("1.2.10", "1.2.9")).toBe(1);
  });

  it("unlesbare Werte sind älter als jede echte Version", () => {
    expect(compareVersions("unknown", "0.1.0")).toBe(-1);
    expect(compareVersions("0.1.0", "unknown")).toBe(1);
    expect(compareVersions(undefined, undefined)).toBe(0);
  });
});

describe("releasePending", () => {
  const dep = (label: string, version?: string, error?: string) => ({
    label,
    url: "https://x",
    app: version ? { version } : undefined,
    error,
  });

  it("meldet einen wartenden Release nur bei Staging > Produktion", () => {
    expect(releasePending([dep("Produktion", "0.1.0"), dep("Staging", "0.2.0")])).toBe(true);
    expect(releasePending([dep("Produktion", "0.2.0"), dep("Staging", "0.2.0")])).toBe(false);
    expect(releasePending([dep("Produktion", "0.3.0"), dep("Staging", "0.2.0")])).toBe(false);
  });

  it("schweigt, wenn eine Umgebung keine Auskunft gab", () => {
    expect(
      releasePending([dep("Produktion", undefined, "nicht erreichbar"), dep("Staging", "0.2.0")]),
    ).toBe(false);
  });
});

describe("buildAge", () => {
  const now = Date.parse("2026-08-22T12:00:00.000Z");

  it("rechnet Minuten, Stunden und Tage", () => {
    expect(buildAge("2026-08-22T11:30:00.000Z", now)).toBe("vor 30 Min.");
    expect(buildAge("2026-08-22T06:00:00.000Z", now)).toBe("vor 6 Std.");
    expect(buildAge("2026-08-18T12:00:00.000Z", now)).toBe("vor 4 Tagen");
  });

  it("null bei fehlender oder kaputter Angabe", () => {
    expect(buildAge(null, now)).toBeNull();
    expect(buildAge("irgendwas", now)).toBeNull();
  });
});

describe("fetchDeployment", () => {
  const target = { label: "Produktion", url: "https://app.example.com" };

  it("liest die app-Auskunft aus der Health-Antwort", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ status: "ok", app: { version: "0.2.0", commit: "abc1234" } }), {
        status: 200,
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(fetchDeployment(target)).resolves.toEqual({
      ...target,
      app: { version: "0.2.0", commit: "abc1234" },
    });
    expect(fetchMock.mock.calls[0][0]).toBe("https://app.example.com/api/v1/health");
    vi.unstubAllGlobals();
  });

  it("HTTP-Fehler, Netzfehler und Antwort ohne Versionsinfo werden als Fehler gemeldet", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("nope", { status: 502 })));
    expect((await fetchDeployment(target)).error).toBe("HTTP 502");

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("boom")));
    expect((await fetchDeployment(target)).error).toBe("nicht erreichbar");

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ status: "ok" }), { status: 200 })),
    );
    const noInfo = await fetchDeployment(target);
    expect(noInfo.error).toBe("Antwort ohne Versionsinfo");
    expect(noInfo.app).toBeUndefined();
    vi.unstubAllGlobals();
  });
});
