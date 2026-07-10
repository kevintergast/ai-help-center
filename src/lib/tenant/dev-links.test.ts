import { describe, expect, it } from "vitest";
import { getTenantSwitchLinks } from "./dev-links";

describe("getTenantSwitchLinks", () => {
  it("baut Subdomain-URLs mit Port und markiert den aktiven Tenant", () => {
    const links = getTenantSwitchLinks("acme.localhost:3000", "http");
    const acme = links.find((l) => l.slug === "acme")!;
    const demo = links.find((l) => l.slug === "demo")!;
    expect(acme.url).toBe("http://acme.localhost:3000");
    expect(acme.active).toBe(true);
    expect(demo.url).toBe("http://demo.localhost:3000");
    expect(demo.active).toBe(false);
  });

  it("nutzt https ohne Port für Prod-Domains", () => {
    const links = getTenantSwitchLinks("demo.hallofhelp.app", "https");
    expect(links.find((l) => l.slug === "acme")!.url).toBe("https://acme.hallofhelp.app");
  });
});
