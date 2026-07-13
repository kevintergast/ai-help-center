import { describe, expect, it } from "vitest";
import {
  isTeamRole,
  resolvePostLoginRedirect,
  roleHome,
  safeInternalPath,
} from "./redirect";

describe("isTeamRole", () => {
  it("erkennt Team-Rollen (content/admin/owner)", () => {
    expect(isTeamRole("content")).toBe(true);
    expect(isTeamRole("admin")).toBe(true);
    expect(isTeamRole("owner")).toBe(true);
  });
  it("lehnt user/leer/unbekannt ab", () => {
    expect(isTeamRole("user")).toBe(false);
    expect(isTeamRole(null)).toBe(false);
    expect(isTeamRole(undefined)).toBe(false);
    expect(isTeamRole("superuser")).toBe(false);
  });
});

describe("roleHome", () => {
  it("Team → /admin, sonst /", () => {
    expect(roleHome("admin")).toBe("/admin");
    expect(roleHome("owner")).toBe("/admin");
    expect(roleHome("content")).toBe("/admin");
    expect(roleHome("user")).toBe("/");
    expect(roleHome(null)).toBe("/");
  });
});

describe("safeInternalPath (Open-Redirect-Schutz)", () => {
  it("akzeptiert einfache interne Pfade", () => {
    expect(safeInternalPath("/admin")).toBe("/admin");
    expect(safeInternalPath("/invite/accept?token=abc")).toBe("/invite/accept?token=abc");
  });
  it("lehnt protokoll-relative und externe Ziele ab", () => {
    expect(safeInternalPath("//evil.com")).toBeNull();
    expect(safeInternalPath("/\\evil.com")).toBeNull();
    expect(safeInternalPath("https://evil.com")).toBeNull();
    expect(safeInternalPath("evil.com")).toBeNull();
  });
  it("lehnt Steuerzeichen (Header-Injection) und Leeres ab", () => {
    expect(safeInternalPath("/admin\nSet-Cookie: x")).toBeNull();
    expect(safeInternalPath("")).toBeNull();
    expect(safeInternalPath(null)).toBeNull();
  });
});

describe("resolvePostLoginRedirect", () => {
  it("ein sicherer Wunsch-Pfad gewinnt über die Rolle", () => {
    expect(resolvePostLoginRedirect({ role: "user", requested: "/help/x" })).toBe("/help/x");
    expect(resolvePostLoginRedirect({ role: "admin", requested: "/stats" })).toBe("/stats");
  });
  it("unsicherer/kein Wunsch → rollen-basiertes Zuhause", () => {
    expect(resolvePostLoginRedirect({ role: "admin", requested: "//evil.com" })).toBe("/admin");
    expect(resolvePostLoginRedirect({ role: "user", requested: null })).toBe("/");
    expect(resolvePostLoginRedirect({ role: "owner", requested: undefined })).toBe("/admin");
  });
});
