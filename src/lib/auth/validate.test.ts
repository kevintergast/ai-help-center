import { describe, expect, it } from "vitest";
import {
  validateEmail,
  validateName,
  validateOtpCode,
  validatePassword,
  validatePasswordConfirm,
} from "./validate";

describe("validateEmail", () => {
  it("akzeptiert gültige Adressen", () => {
    expect(validateEmail("a@b.de")).toBeNull();
    expect(validateEmail("  name@example.com  ")).toBeNull();
  });
  it("meldet leer bzw. ungültig", () => {
    expect(validateEmail("")).toBe("auth.validate.emailRequired");
    expect(validateEmail("   ")).toBe("auth.validate.emailRequired");
    expect(validateEmail("no-at")).toBe("auth.validate.emailInvalid");
    expect(validateEmail("a@b")).toBe("auth.validate.emailInvalid");
  });
});

describe("validatePassword", () => {
  it("verlangt mind. 10 Zeichen", () => {
    expect(validatePassword("")).toBe("auth.validate.passwordRequired");
    expect(validatePassword("short")).toBe("auth.validate.passwordTooShort");
    expect(validatePassword("0123456789")).toBeNull();
  });
});

describe("validateName", () => {
  it("verlangt nicht-leeren Namen", () => {
    expect(validateName("  ")).toBe("auth.validate.nameRequired");
    expect(validateName("Kim")).toBeNull();
  });
});

describe("validateOtpCode", () => {
  it("verlangt genau 6 Ziffern", () => {
    expect(validateOtpCode("123456")).toBeNull();
    expect(validateOtpCode(" 123456 ")).toBeNull();
    expect(validateOtpCode("12345")).toBe("auth.validate.codeInvalid");
    expect(validateOtpCode("12345a")).toBe("auth.validate.codeInvalid");
  });
});

describe("validatePasswordConfirm", () => {
  it("erst Passwortregeln, dann Gleichheit", () => {
    expect(validatePasswordConfirm("short", "short")).toBe("auth.validate.passwordTooShort");
    expect(validatePasswordConfirm("0123456789", "different99")).toBe("auth.reset.mismatch");
    expect(validatePasswordConfirm("0123456789", "0123456789")).toBeNull();
  });
});
