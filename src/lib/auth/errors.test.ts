import { describe, expect, it } from "vitest";
import { mapAuthError } from "./errors";

describe("mapAuthError", () => {
  it("mappt bekannte better-auth-Codes auf i18n-Keys", () => {
    expect(mapAuthError({ code: "INVALID_EMAIL_OR_PASSWORD" })).toBe(
      "auth.error.invalidCredentials",
    );
    expect(mapAuthError({ code: "EMAIL_NOT_VERIFIED" })).toBe("auth.error.emailNotVerified");
    expect(mapAuthError({ code: "USER_ALREADY_EXISTS" })).toBe("auth.error.emailInUse");
    expect(mapAuthError({ code: "ACCOUNT_TEMPORARILY_LOCKED" })).toBe("auth.error.accountLocked");
    expect(mapAuthError({ code: "INVALID_CODE" })).toBe("auth.error.invalidCode");
    expect(mapAuthError({ code: "OTP_HAS_EXPIRED" })).toBe("auth.error.codeExpired");
    expect(mapAuthError({ code: "INVALID_TOKEN" })).toBe("auth.error.linkInvalid");
    expect(mapAuthError({ code: "BANNED_USER" })).toBe("auth.error.banned");
  });

  it("unbekannter Code → generisch (nie Backend-Rohtext)", () => {
    expect(mapAuthError({ code: "SOME_NEW_CODE", message: "leak me" })).toBe("auth.error.generic");
  });

  it("kein Code + kein/0-Status → Netzwerkfehler; kein Code + Status → generisch", () => {
    expect(mapAuthError({ message: "fetch failed" })).toBe("auth.error.network");
    expect(mapAuthError({ status: 0 })).toBe("auth.error.network");
    expect(mapAuthError({ status: 500 })).toBe("auth.error.generic");
  });

  it("null/undefined → generisch", () => {
    expect(mapAuthError(null)).toBe("auth.error.generic");
    expect(mapAuthError(undefined)).toBe("auth.error.generic");
  });
});
