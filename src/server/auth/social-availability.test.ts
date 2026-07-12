import { describe, expect, it } from "vitest";
import { availableSocialProviders, socialProvidersFromEnv } from "./social";

/**
 * „Provider verfügbar?"-Ableitung fürs Auth-UI (Punkt 4a). Nur vollständige
 * Credential-Paare (Client-ID + Secret) zählen; ein halb konfigurierter Provider
 * darf NICHT als Button erscheinen (Sign-in würde sonst erst beim IdP scheitern).
 */
describe("availableSocialProviders", () => {
  it("listet nur vollständig konfigurierte Provider", () => {
    expect(
      availableSocialProviders({
        google: { clientId: "gid", clientSecret: "gsec" },
        microsoft: { clientId: "mid", clientSecret: "msec" },
      }),
    ).toEqual(["google", "microsoft"]);
  });

  it("blendet Provider ohne vollständige Credentials aus (Microsoft ohne Key)", () => {
    expect(
      availableSocialProviders({
        google: { clientId: "gid", clientSecret: "gsec" },
        microsoft: { clientId: "mid" }, // Secret fehlt
      }),
    ).toEqual(["google"]);
    expect(availableSocialProviders({ google: { clientId: "" } })).toEqual([]);
    expect(availableSocialProviders(undefined)).toEqual([]);
  });

  it("greift durch socialProvidersFromEnv: fehlender Microsoft-Key → nur google", () => {
    const providers = availableSocialProviders(
      socialProvidersFromEnv({
        GOOGLE_CLIENT_ID: "gid",
        GOOGLE_CLIENT_SECRET: "gsec",
        // MICROSOFT_* absichtlich nicht gesetzt
      }),
    );
    expect(providers).toEqual(["google"]);
  });
});
