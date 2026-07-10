import { describe, expect, it } from "vitest";
import { resolveWithSourceStrict, type TenantSource } from "./resolve-tenant";
import type { Tenant } from "@/lib/tenant/types";

function tenant(slug: string, customDomain: string | null = null): Tenant {
  return {
    id: `t_${slug}`,
    slug,
    name: slug,
    customDomain,
    defaultLocale: "de",
    branding: { logoUrl: null, colorPrimary: "#000", colorAccent: "#111", colorPrimaryFg: "#fff" },
  };
}

// Fake-Source statt echter D1 — testet die Entscheidungslogik ohne Cloud.
const source: TenantSource = {
  async getBySlug(slug) {
    return slug === "acme" ? tenant("acme") : null;
  },
  async getByCustomDomain(domain) {
    return domain === "hilfe.kunde.de" ? tenant("kunde", "hilfe.kunde.de") : null;
  },
};

describe("resolveWithSourceStrict (fail-closed — einzige Auflösungs-Variante)", () => {
  it("löst per Subdomain-Slug auf", async () => {
    expect((await resolveWithSourceStrict(source, "acme.hallofhelp.app"))?.slug).toBe("acme");
  });

  it("löst eine bekannte Custom-Domain (Bring-your-own) auf", async () => {
    expect((await resolveWithSourceStrict(source, "hilfe.kunde.de"))?.slug).toBe("kunde");
  });

  it("gibt bei unbekannter Instanz NULL zurück (kein Default-/Demo-Fallback)", async () => {
    expect(await resolveWithSourceStrict(source, "unknown.hallofhelp.app")).toBeNull();
    expect(await resolveWithSourceStrict(source, "hallofhelp.app")).toBeNull();
    expect(await resolveWithSourceStrict(source, "fremde-domain.de")).toBeNull();
    expect(await resolveWithSourceStrict(source, null)).toBeNull();
  });
});
