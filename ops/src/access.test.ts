import { describe, expect, it } from "vitest";
import { checkAccess, verifyAccessJwt, type OpsEnv } from "./access";

/**
 * ACCESS-GUARD (Sicherheits-Invariante des Ops-Dashboards). Verhinderte
 * Fehlerfälle:
 *  - Gefälschte/abgelaufene/fremde JWTs erreichen das Dashboard (alle
 *    Tenant-Daten wären lesbar!).
 *  - Fehlende Access-Konfiguration lässt den Worker OFFEN statt 503.
 */

const TEAM = "example.cloudflareaccess.com";
const AUD = "test-aud-1234";

async function makeKeyAndToken(payload: Record<string, unknown>, kid = "k1") {
  const pair = (await crypto.subtle.generateKey(
    { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const jwk = (await crypto.subtle.exportKey("jwk", pair.publicKey)) as {
    kty: string;
    n: string;
    e: string;
  };
  const b64 = (obj: unknown) =>
    btoa(JSON.stringify(obj)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  const head = b64({ alg: "RS256", kid });
  const body = b64(payload);
  const sig = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5",
    pair.privateKey,
    new TextEncoder().encode(`${head}.${body}`),
  );
  const sigB64 = btoa(String.fromCharCode(...new Uint8Array(sig)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return { token: `${head}.${body}.${sigB64}`, jwks: [{ kid, kty: jwk.kty, n: jwk.n, e: jwk.e }] };
}

const NOW = 1_800_000_000;
const validPayload = {
  aud: [AUD],
  iss: `https://${TEAM}`,
  exp: NOW + 3600,
  email: "kevin@hallofhelp.com",
};

describe("verifyAccessJwt", () => {
  it("akzeptiert ein gültiges Token (aud, iss, exp, Signatur)", async () => {
    const { token, jwks } = await makeKeyAndToken(validPayload);
    const result = await verifyAccessJwt(token, {
      teamDomain: TEAM,
      aud: AUD,
      nowSec: NOW,
      jwksOverride: jwks,
    });
    expect(result).toEqual({ email: "kevin@hallofhelp.com" });
  });

  it.each([
    ["falsche Audience", { ...validPayload, aud: ["andere-app"] }],
    ["falscher Issuer", { ...validPayload, iss: "https://boese.example" }],
    ["abgelaufen", { ...validPayload, exp: NOW - 3600 }],
    ["ohne E-Mail", { ...validPayload, email: undefined }],
  ] as const)("lehnt ab: %s", async (_label, payload) => {
    const { token, jwks } = await makeKeyAndToken(payload as Record<string, unknown>);
    expect(
      await verifyAccessJwt(token, { teamDomain: TEAM, aud: AUD, nowSec: NOW, jwksOverride: jwks }),
    ).toBeNull();
  });

  it("lehnt Tokens mit FREMDEM Schlüssel ab (Signatur zählt, nicht nur Claims)", async () => {
    const { token } = await makeKeyAndToken(validPayload);
    const other = await makeKeyAndToken(validPayload); // anderes Schlüsselpaar, gleiche kid
    expect(
      await verifyAccessJwt(token, {
        teamDomain: TEAM,
        aud: AUD,
        nowSec: NOW,
        jwksOverride: other.jwks,
      }),
    ).toBeNull();
  });
});

describe("checkAccess — fail-closed", () => {
  const env = (over: Partial<OpsEnv> = {}): OpsEnv =>
    ({ DB: null as unknown as D1Database, ...over }) as OpsEnv;

  it("ohne Konfiguration → unconfigured (503-Semantik); expliziter Dev-Bypass → Dev-Identität", async () => {
    const deployed = await checkAccess(env(), new Request("https://ops.hallofhelp.com/"));
    expect(deployed).toEqual({ ok: false, reason: "unconfigured" });

    const local = await checkAccess(
      env({ OPS_DEV_BYPASS: "1" }),
      new Request("https://ops.dev.hallofhelp.com/"),
    );
    expect(local).toEqual({ ok: true, email: "dev@localhost" });
  });

  it("konfiguriert, aber ohne/mit kaputtem JWT → denied", async () => {
    const configured = env({ ACCESS_TEAM_DOMAIN: TEAM, ACCESS_AUD: AUD });
    const noJwt = await checkAccess(configured, new Request("https://ops.dev.hallofhelp.com/"));
    expect(noJwt).toEqual({ ok: false, reason: "denied" });

    const badJwt = await checkAccess(
      configured,
      new Request("https://ops.hallofhelp.com/", {
        headers: { "cf-access-jwt-assertion": "kaputt.kaputt.kaputt" },
      }),
    );
    expect(badJwt).toEqual({ ok: false, reason: "denied" });
  });

  it("Platzhalter '<FILL>' zählt als NICHT konfiguriert (fail-closed)", async () => {
    const res = await checkAccess(
      env({ ACCESS_TEAM_DOMAIN: "<FILL>", ACCESS_AUD: "<FILL>" }),
      new Request("https://ops.hallofhelp.com/"),
    );
    expect(res).toEqual({ ok: false, reason: "unconfigured" });
  });
});
