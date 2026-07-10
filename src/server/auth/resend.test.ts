import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { __resetResendWarningForTests, createEmailSenders, sendEmail } from "./resend";

describe("Resend E-Mail-Versand (inert ohne Key)", () => {
  beforeEach(() => {
    __resetResendWarningForTests();
    vi.restoreAllMocks();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("ist ohne RESEND_API_KEY ein No-op: kein throw, kein fetch, gibt false zurück", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");

    const sent = await sendEmail({}, { to: "x@example.com", subject: "Hi", html: "<p>Hi</p>" });

    expect(sent).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("warnt nur EINMAL, auch bei mehreren No-op-Sends", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await sendEmail({}, { to: "a@example.com", subject: "1", html: "x" });
    await sendEmail({}, { to: "b@example.com", subject: "2", html: "y" });
    await sendEmail({}, { to: "c@example.com", subject: "3", html: "z" });
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("die better-auth-Callbacks sind ohne Key ebenfalls inert (kein throw)", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const senders = createEmailSenders({});

    await expect(
      senders.sendVerificationEmail({ user: { email: "u@example.com" }, url: "https://x/v", token: "t" }),
    ).resolves.toBeUndefined();
    await expect(
      senders.sendResetPassword({ user: { email: "u@example.com" }, url: "https://x/r", token: "t" }),
    ).resolves.toBeUndefined();

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("mit Key wird Resend über HTTP aufgerufen (Authorization gesetzt, kein Key im Klartext geloggt)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "eml_1" }), { status: 200 }));

    const sent = await sendEmail(
      { RESEND_API_KEY: "re_secret_key" },
      { to: "x@example.com", subject: "Hi", html: "<p>Hi</p>", from: "Test <t@example.com>" },
    );

    expect(sent).toBe(true);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    const headers = init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer re_secret_key");
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ to: "x@example.com", subject: "Hi", from: "Test <t@example.com>" });
  });

  it("mit Key wirft bei einer Fehlerantwort von Resend (kein stilles Schlucken)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("nope", { status: 422 }),
    );
    await expect(
      sendEmail({ RESEND_API_KEY: "re_x" }, { to: "x@example.com", subject: "s", html: "h" }),
    ).rejects.toThrow(/422/);
  });
});
