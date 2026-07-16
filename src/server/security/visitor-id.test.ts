import { describe, expect, it } from "vitest";
import { makeVisitorIdCodec } from "./visitor-id";

/**
 * Signierte Besucher-IDs (Abuse-Härtung): Diese Tests verhindern konkret,
 * dass (1) erfundene IDs ins Metering gelangen (Credits-/MAU-Sabotage durch
 * Cookie-Rotation) und (2) IDs tenant-übergreifend wiederverwendbar sind.
 */
describe("visitor-id codec", () => {
  const codec = makeVisitorIdCodec("test-secret-mindestens-lang-genug");

  it("stellt IDs aus, die für denselben Tenant verifizieren", async () => {
    const id = await codec.issue("t_a");
    expect(await codec.verify("t_a", id)).toBe(id);
  });

  it("weist IDs eines ANDEREN Tenants ab (kein Cross-Tenant-Replay)", async () => {
    const id = await codec.issue("t_a");
    expect(await codec.verify("t_b", id)).toBeNull();
  });

  it("weist manipulierte Signaturen ab", async () => {
    const id = await codec.issue("t_a");
    const flipped = id.slice(0, -1) + (id.endsWith("A") ? "B" : "A");
    expect(await codec.verify("t_a", flipped)).toBeNull();
  });

  it("weist erfundene/deformierte Werte ab (UUIDs, Müll, Überlänge)", async () => {
    expect(await codec.verify("t_a", crypto.randomUUID())).toBeNull();
    expect(await codec.verify("t_a", "kein-punkt")).toBeNull();
    expect(await codec.verify("t_a", ".sig-ohne-teil")).toBeNull();
    expect(await codec.verify("t_a", "x".repeat(200))).toBeNull();
  });

  it("bindet die Signatur an den Zufallsteil (Teil-Tausch scheitert)", async () => {
    const a = await codec.issue("t_a");
    const b = await codec.issue("t_a");
    const [partA] = a.split(".");
    const [, sigB] = b.split(".");
    expect(await codec.verify("t_a", `${partA}.${sigB}`)).toBeNull();
  });

  it("verschiedene Secrets erzeugen inkompatible IDs", async () => {
    const other = makeVisitorIdCodec("ein-ganz-anderes-secret-wert");
    const id = await codec.issue("t_a");
    expect(await other.verify("t_a", id)).toBeNull();
  });
});
