import { describe, expect, it } from "vitest";
import { AUTH_BASE_PATH as SERVER_BASE_PATH } from "@/server/auth/auth";
import { AUTH_BASE_PATH as CLIENT_BASE_PATH } from "./base-path";

/**
 * Der client-sichere Duplikat-Wert MUSS mit dem maßgeblichen Server-Wert
 * übereinstimmen — sonst würde der React-Client gegen einen anderen Mount-Pfad
 * sprechen als better-auth serverseitig lauscht. Dieser Test bricht bei Drift.
 */
describe("AUTH_BASE_PATH-Parität (Client ↔ Server)", () => {
  it("ist identisch", () => {
    expect(CLIENT_BASE_PATH).toBe(SERVER_BASE_PATH);
  });
});
