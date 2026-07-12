import { describe, expect, it } from "vitest";
import {
  isLegalDocType,
  MAX_LEGAL_MARKDOWN_BYTES,
  normalizeHttpsUrl,
  parseLegalDoc,
} from "./validate";

/**
 * VALIDIERUNG Legal-Docs — Verhalten/Verträge, inkl. Injection-Versuche.
 * Jeder benennbare Fehlerfall: URL-Scheme-Injection, Modus-Inkonsistenz,
 * Größenlimit, gespeicherter (nie ausgeführter) Script-Tag im Markdown.
 */

describe("isLegalDocType", () => {
  it("akzeptiert genau imprint/privacy/terms, lehnt alles andere ab", () => {
    for (const t of ["imprint", "privacy", "terms"]) expect(isLegalDocType(t)).toBe(true);
    for (const t of ["", "IMPRINT", "cookies", "../imprint", null, 42, undefined]) {
      expect(isLegalDocType(t)).toBe(false);
    }
  });
});

describe("normalizeHttpsUrl (Scheme-Whitelist gegen href-Injection)", () => {
  it("akzeptiert absolute https-URLs (auch mit Bindestrich/Pfad/Query)", () => {
    expect(normalizeHttpsUrl("https://acme-corp.example/impressum?x=1")).toBe(
      "https://acme-corp.example/impressum?x=1",
    );
    expect(normalizeHttpsUrl("  https://example.com/a  ")).toBe("https://example.com/a");
  });

  it("lehnt gefährliche/andere Schemata HART ab", () => {
    for (const bad of [
      "http://example.com",
      "javascript:alert(1)",
      "JavaScript:alert(1)",
      "data:text/html,<script>alert(1)</script>",
      "vbscript:msgbox(1)",
      "//example.com",
      "/relative",
      "ftp://example.com",
      "https:/example.com", // kaputt
      "",
      "   ",
    ]) {
      expect(normalizeHttpsUrl(bad), bad).toBeNull();
    }
  });

  it("lehnt eingebettete Steuerzeichen/Whitespace ab (Scheme-Verschleierung)", () => {
    expect(normalizeHttpsUrl("https://exa\tmple.com")).toBeNull();
    expect(normalizeHttpsUrl("java\nscript:alert(1)")).toBeNull();
    expect(normalizeHttpsUrl("https://exa mple.com")).toBeNull();
  });
});

describe("parseLegalDoc", () => {
  it("link: gültige https-URL → ok, markdown null", () => {
    const r = parseLegalDoc({ mode: "link", url: "https://example.com/impressum" });
    expect(r).toEqual({
      ok: true,
      value: { mode: "link", url: "https://example.com/impressum", markdown: null },
    });
  });

  it("link mit javascript:-URL → 400 invalid_url", () => {
    const r = parseLegalDoc({ mode: "link", url: "javascript:alert(1)" });
    expect(r).toEqual({ ok: false, error: "invalid_url", status: 400 });
  });

  it("link mit data:-URL → 400 invalid_url", () => {
    const r = parseLegalDoc({ mode: "link", url: "data:text/html,<script>alert(1)</script>" });
    expect(r).toMatchObject({ ok: false, error: "invalid_url" });
  });

  it("link ohne url → 400 url_required; link mit zusätzlichem markdown → 400 markdown_not_allowed", () => {
    expect(parseLegalDoc({ mode: "link" })).toMatchObject({ ok: false, error: "url_required" });
    expect(
      parseLegalDoc({ mode: "link", url: "https://example.com", markdown: "# hi" }),
    ).toMatchObject({ ok: false, error: "markdown_not_allowed" });
  });

  it("markdown: Text wird als DATEN übernommen (Script-Tag bleibt reiner Text)", () => {
    const md = "# Impressum\n\n<script>alert('xss')</script>\n[x](javascript:alert(1))";
    const r = parseLegalDoc({ mode: "markdown", markdown: md });
    expect(r).toEqual({ ok: true, value: { mode: "markdown", url: null, markdown: md } });
  });

  it("markdown zu groß (>100 KB) → 413 markdown_too_large", () => {
    const big = "a".repeat(MAX_LEGAL_MARKDOWN_BYTES + 1);
    expect(parseLegalDoc({ mode: "markdown", markdown: big })).toEqual({
      ok: false,
      error: "markdown_too_large",
      status: 413,
    });
  });

  it("markdown fehlend/leer → 400 markdown_required; markdown mit zusätzlicher url → 400 url_not_allowed", () => {
    expect(parseLegalDoc({ mode: "markdown", markdown: "   " })).toMatchObject({
      ok: false,
      error: "markdown_required",
    });
    expect(
      parseLegalDoc({ mode: "markdown", markdown: "# hi", url: "https://example.com" }),
    ).toMatchObject({ ok: false, error: "url_not_allowed" });
  });

  it("unbekannter Modus / Nicht-Objekt → 400", () => {
    expect(parseLegalDoc({ mode: "html", markdown: "x" })).toMatchObject({
      ok: false,
      error: "invalid_mode",
    });
    expect(parseLegalDoc(null)).toMatchObject({ ok: false, error: "invalid_body" });
    expect(parseLegalDoc("nope")).toMatchObject({ ok: false, error: "invalid_body" });
  });
});
