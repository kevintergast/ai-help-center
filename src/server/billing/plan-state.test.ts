import { describe, expect, it } from "vitest";
import { evaluatePlanState, GRACE_DAYS } from "./plan-state";
import { computeOverage, periodOf, periodResetMs, PLANS } from "./pricing";

/**
 * Preis-/Statuslogik (Infra-Plan Schritt 3). Verhinderte Fehlerfälle:
 *  - Free läuft trotz überschrittener Credits ewig weiter (kein Freeze).
 *  - Bezahlter Plan wird bei Credit-Overage fälschlich eingefroren (Overage
 *    ist dort METERED Mehrverbrauch, kein Verstoß).
 *  - Grace verlängert sich schleichend oder friert einen Tag zu früh ein.
 *  - Overage-Rechnung rundet Pakete falsch (angefangene Pakete zählen voll).
 *  - Monatswechsel-/Reset-Berechnung kippt an UTC-Grenzen (Dezember→Januar).
 */

const DAY = 86_400;
const NOW = 1_800_000_000; // fixe Unix-Sekunden (Determinismus)

describe("evaluatePlanState — Statuskette active → over_limit → frozen", () => {
  it("Free im Limit → active (auch exakt AM Limit)", () => {
    const s = evaluatePlanState({
      plan: "free",
      creditsUsed: PLANS.free.includedCredits, // genau am Limit = noch drin
      mauCount: PLANS.free.mauLimit,
      overLimitSince: null,
      nowSec: NOW,
    });
    expect(s.status).toBe("active");
    expect(s.isOver).toBe(false);
  });

  it("Free über Credits → over_limit mit voller Grace; nach 30 Tagen → frozen", () => {
    const over = evaluatePlanState({
      plan: "free",
      creditsUsed: PLANS.free.includedCredits + 1,
      mauCount: 0,
      overLimitSince: NOW,
      nowSec: NOW,
    });
    expect(over.status).toBe("over_limit");
    expect(over.overCredits).toBe(true);
    expect(over.graceDaysLeft).toBe(GRACE_DAYS); // am Grace-Beginn: volle 30 Tage

    const lastGraceSecond = evaluatePlanState({
      plan: "free",
      creditsUsed: PLANS.free.includedCredits + 1,
      mauCount: 0,
      overLimitSince: NOW,
      nowSec: NOW + GRACE_DAYS * DAY - 1,
    });
    expect(lastGraceSecond.status).toBe("over_limit");

    const frozen = evaluatePlanState({
      plan: "free",
      creditsUsed: PLANS.free.includedCredits + 1,
      mauCount: 0,
      overLimitSince: NOW,
      nowSec: NOW + GRACE_DAYS * DAY,
    });
    expect(frozen.status).toBe("frozen");
  });

  it("Paid: Credit-Overage bleibt ACTIVE (metered); nur MAU-Verstoß gated", () => {
    const overage = evaluatePlanState({
      plan: "starter",
      creditsUsed: PLANS.starter.includedCredits * 3,
      mauCount: 10,
      overLimitSince: null,
      nowSec: NOW,
    });
    expect(overage.status).toBe("active");

    const mau = evaluatePlanState({
      plan: "starter",
      creditsUsed: 0,
      mauCount: PLANS.starter.mauLimit + 1,
      overLimitSince: null,
      nowSec: NOW,
    });
    expect(mau.status).toBe("over_limit");
    expect(mau.overMau).toBe(true);
  });

  it("wieder im Limit (neue Periode/Upgrade) → active, auch wenn der Marker noch steht", () => {
    const s = evaluatePlanState({
      plan: "free",
      creditsUsed: 0,
      mauCount: 0,
      overLimitSince: NOW - 90 * DAY, // veralteter Marker
      nowSec: NOW,
    });
    expect(s.status).toBe("active");
  });
});

describe("computeOverage — Paket-Rundung + Free-Sonderfall", () => {
  it("im Kontingent → 0/0/0", () => {
    expect(computeOverage(PLANS.starter, PLANS.starter.includedCredits)).toEqual({
      overageCredits: 0,
      packs: 0,
      amountCents: 0,
    });
  });

  it("angefangenes Paket zählt voll; exakte Paketgrenze bleibt 1 Paket", () => {
    expect(computeOverage(PLANS.starter, PLANS.starter.includedCredits + 1)).toMatchObject({
      packs: 1,
      amountCents: PLANS.starter.overagePackCents,
    });
    expect(computeOverage(PLANS.starter, PLANS.starter.includedCredits + 5_000)).toMatchObject({
      packs: 1,
    });
    expect(computeOverage(PLANS.starter, PLANS.starter.includedCredits + 5_001)).toMatchObject({
      packs: 2,
    });
  });

  it("Free: Overage nicht kaufbar → Betrag 0, Credits trotzdem ausgewiesen", () => {
    const r = computeOverage(PLANS.free, PLANS.free.includedCredits + 999);
    expect(r).toEqual({ overageCredits: 999, packs: 0, amountCents: 0 });
  });
});

describe("periodOf / periodResetMs — UTC-Monatsgrenzen", () => {
  it("Jahreswechsel: 31.12. 23:59:59Z → Periode des Dezembers, Reset = 1.1.", () => {
    const dec31 = Date.UTC(2026, 11, 31, 23, 59, 59);
    expect(periodOf(dec31)).toBe("2026-12");
    expect(periodResetMs(dec31)).toBe(Date.UTC(2027, 0, 1));
  });

  it("Monatsanfang gehört zur NEUEN Periode (kein Off-by-one)", () => {
    const aug1 = Date.UTC(2026, 7, 1, 0, 0, 0);
    expect(periodOf(aug1)).toBe("2026-08");
  });
});

describe("Per-Instanz-Rahmen (0022, Ops: Enterprise-Deckel)", () => {
  it("Overrides ersetzen die Plan-Standards und steuern die Limit-Prüfung", () => {
    // Enterprise-Standard wäre 1 Mio Credits / 100k MAU — der individuelle
    // Deckel (500/50) muss die Prüfung übernehmen (sonst wäre er nur Anzeige).
    const over = evaluatePlanState({
      plan: "enterprise",
      creditsUsed: 600,
      mauCount: 51,
      overLimitSince: null,
      customIncludedCredits: 500,
      customMauLimit: 50,
      nowSec: NOW,
    });
    expect(over.plan.includedCredits).toBe(500);
    expect(over.plan.mauLimit).toBe(50);
    expect(over.isOver).toBe(true);

    const within = evaluatePlanState({
      plan: "enterprise",
      creditsUsed: 400,
      mauCount: 10,
      overLimitSince: null,
      customIncludedCredits: 500,
      customMauLimit: 50,
      nowSec: NOW,
    });
    expect(within.status).toBe("active");

    // Ohne Overrides: Plan-Standard unverändert.
    const std = evaluatePlanState({
      plan: "enterprise",
      creditsUsed: 600,
      mauCount: 51,
      overLimitSince: null,
      nowSec: NOW,
    });
    expect(std.plan.includedCredits).toBe(PLANS.enterprise.includedCredits);
    expect(std.isOver).toBe(false);
  });
});
