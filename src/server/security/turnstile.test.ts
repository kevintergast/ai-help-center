import { describe, expect, it } from "vitest";
import {
  buildCaptchaPlugin,
  CAPTCHA_PROTECTED_ENDPOINTS,
  makeTurnstileVerify,
  verifyTurnstileToken,
} from "./turnstile";

/**
 * Turnstile-Entscheidungslogik (Infra-Plan Schritt 2). Verhinderte Fehlerfälle:
 *  - Fehlkonfiguration in Prod schaltet den Bot-Schutz stillschweigend ab.
 *  - siteverify-Ausfall/Timeout/HTTP-Fehler lässt Bots durch (fail-open).
 *  - Login gerät versehentlich unter Captcha-Zwang (Endpoint-Liste).
 * Das Plugin-INNERE (Header-Parsing etc.) ist better-auth-Verhalten und wird
 * bewusst nicht mitgetestet (Test-Policy: keine Framework-Tests).
 */

function fakeFetch(response: { ok?: boolean; body?: unknown; throwErr?: boolean }): typeof fetch {
  return (async () => {
    if (response.throwErr) throw new Error("network down");
    return new Response(JSON.stringify(response.body ?? {}), {
      status: response.ok === false ? 500 : 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;
}

describe("verifyTurnstileToken", () => {
  it("success:true → true; success:false → false", async () => {
    expect(
      await verifyTurnstileToken({
        secretKey: "s",
        token: "t",
        fetchImpl: fakeFetch({ body: { success: true } }),
      }),
    ).toBe(true);
    expect(
      await verifyTurnstileToken({
        secretKey: "s",
        token: "t",
        fetchImpl: fakeFetch({ body: { success: false } }),
      }),
    ).toBe(false);
  });

  it("HTTP-Fehler oder Netzwerk-Throw → false (fail-closed, kein Durchwinken)", async () => {
    expect(
      await verifyTurnstileToken({
        secretKey: "s",
        token: "t",
        fetchImpl: fakeFetch({ ok: false, body: { success: true } }),
      }),
    ).toBe(false);
    expect(
      await verifyTurnstileToken({
        secretKey: "s",
        token: "t",
        fetchImpl: fakeFetch({ throwErr: true }),
      }),
    ).toBe(false);
  });
});

describe("makeTurnstileVerify — Secret×Umgebung-Matrix", () => {
  it("kein Secret: dev → ok (Schutz aus), Prod → unavailable (fail-closed)", async () => {
    const dev = makeTurnstileVerify({ secretKey: null, isProduction: false });
    expect(await dev("irrelevant")).toBe("ok");
    expect(await dev(null)).toBe("ok");

    const prod = makeTurnstileVerify({ secretKey: null, isProduction: true });
    expect(await prod("irrelevant")).toBe("unavailable");
    expect(await prod(null)).toBe("unavailable");
  });

  it("mit Secret: fehlendes Token → missing; ungültig → failed; gültig → ok", async () => {
    const verify = makeTurnstileVerify({
      secretKey: "s",
      isProduction: true,
      fetchImpl: fakeFetch({ body: { success: true } }),
    });
    expect(await verify(null)).toBe("missing");
    expect(await verify("tok")).toBe("ok");

    const failing = makeTurnstileVerify({
      secretKey: "s",
      isProduction: true,
      fetchImpl: fakeFetch({ body: { success: false } }),
    });
    expect(await failing("tok")).toBe("failed");
  });
});

describe("buildCaptchaPlugin — Registrierungs-Matrix", () => {
  it("dev ohne Secret → kein Plugin (Signup lokal ohne Widget möglich)", () => {
    expect(buildCaptchaPlugin({ secretKey: null, isProduction: false })).toBeNull();
  });

  it("Prod ohne Secret → Plugin MIT leerem Secret (geschützte Endpunkte fail-closed)", () => {
    const plugin = buildCaptchaPlugin({ secretKey: null, isProduction: true });
    expect(plugin).not.toBeNull();
    expect(plugin!.id).toBe("captcha");
  });

  it("mit Secret → Plugin aktiv; Login ist BEWUSST nicht in der Endpoint-Liste", () => {
    const plugin = buildCaptchaPlugin({ secretKey: "s", isProduction: false });
    expect(plugin).not.toBeNull();
    expect(CAPTCHA_PROTECTED_ENDPOINTS).toContain("/sign-up/email");
    expect(CAPTCHA_PROTECTED_ENDPOINTS).toContain("/request-password-reset");
    expect(CAPTCHA_PROTECTED_ENDPOINTS).not.toContain("/sign-in/email");
  });
});
