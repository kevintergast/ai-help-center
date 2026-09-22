import { describe, expect, it } from "vitest";
import type { Tenant } from "@/lib/tenant/types";
import type { AskInput, AskOutcome } from "@/server/rag/ask";
import { buildApiApp } from "./app";
import type { ApiDeps } from "./context";

/**
 * API-VERTRAG POST /api/v1/ask (Pipeline-Logik: rag/ask.test.ts).
 * Verhinderte Fehlerfälle:
 *  - /ask verlangt plötzlich eine Session (Produkt ist für Anonyme).
 *  - Validierung lässt Leer-/Riesen-Fragen zur (kostenpflichtigen) Pipeline durch.
 *  - fehlende Bindings oder frozen werden nicht sauber signalisiert.
 */

const HOST = "demo.hallofhelp.com";
const TENANT: Tenant = {
  id: "t_demo",
  slug: "demo",
  name: "Demo",
  customDomain: null,
  defaultLocale: "de",
  branding: { logoUrl: null, colorPrimary: "#000", colorAccent: "#111", colorPrimaryFg: "#fff" },
};

function makeApp(outcome: AskOutcome | null) {
  const askCalls: AskInput[] = [];
  const deps: ApiDeps = {
    resolveTenant: async (host) =>
      (host ?? "").split(":")[0].toLowerCase() === HOST ? TENANT : null,
    createAuthForTenant: async () => {
      throw new Error("nicht benötigt — /ask ist public und liest keine Session ohne Cookie");
    },
    getBrandingDeps: async () => null,
    getTeamDeps: async () => null,
    getLegalDeps: async () => null,
    getContentDeps: async () => null,
    ...(outcome
      ? {
          getAskDeps: async () => ({
            answer: async (input: AskInput) => {
              askCalls.push(input);
              return outcome;
            },
          }),
        }
      : {}),
  };
  return { app: buildApiApp(deps), askCalls };
}

const post = (app: ReturnType<typeof makeApp>["app"], body: unknown) =>
  app.request("/api/v1/ask", {
    method: "POST",
    headers: { host: HOST, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

const OK: AskOutcome = {
  status: "ok",
  answer: {
    question: "Wie lade ich mein Team ein?",
    body: ["Antwort."],
    citations: [{ id: "a1", title: "Team" }],
    grounded: true,
    sourceRefs: [{ articleId: "a1", chunkIndex: 0, contentHash: "h" }],
  },
};

describe("POST /api/v1/ask", () => {
  it("public + anonym: 200 mit AskAnswer-Shape, Frage normalisiert, OHNE Besucher-Cookie", async () => {
    const { app, askCalls } = makeApp(OK);
    const res = await post(app, { question: "  Wie   lade ich mein Team ein?  " });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ grounded: true, citations: [{ id: "a1" }] });
    expect(askCalls[0].question).toBe("Wie lade ich mein Team ein?");
    expect(askCalls[0].actor.actorType).toBe("anon");
    // Die Besucher-ID wird serverseitig abgeleitet (security/visitor-id.ts) —
    // /ask darf nichts mehr im Endgerät ablegen, sonst wäre die Instanz
    // wieder einwilligungspflichtig.
    expect(res.headers.getSetCookie().some((c) => c.startsWith("hoh_vid="))).toBe(false);
  });

  it("Validierung: fehlend/zu kurz/zu lang/kein JSON → 400, Pipeline wird NIE berührt", async () => {
    const { app, askCalls } = makeApp(OK);
    expect((await post(app, {})).status).toBe(400);
    expect((await post(app, { question: "ab" })).status).toBe(400);
    expect((await post(app, { question: "x".repeat(401) })).status).toBe(400);
    expect(
      (
        await app.request("/api/v1/ask", {
          method: "POST",
          headers: { host: HOST },
          body: "kein json",
        })
      ).status,
    ).toBe(400);
    expect(askCalls).toHaveLength(0);
  });

  it("fehlende Bindings → 503 ask_unavailable; frozen → 402 plan_frozen", async () => {
    const none = makeApp(null);
    const unavailable = await post(none.app, { question: "Gültige Frage?" });
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ error: "ask_unavailable" });

    const frozen = makeApp({ status: "frozen" });
    const res = await post(frozen.app, { question: "Gültige Frage?" });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({ error: "plan_frozen" });
  });
});

/**
 * API-VERTRAG POST /api/v1/unanswered/report (0047).
 *
 * Verhinderte Fehlerfälle:
 *  - Der Melde-Weg verlangt plötzlich eine Session → genau die Nutzer, die
 *    gerade keine Antwort bekommen haben, könnten nichts mehr melden.
 *  - Leere/riesige Fragen oder Unsinns-Adressen landen in der Warteschlange.
 *  - Ein Tippfehler in der Adresse wird still verschluckt: Der Melder wartet
 *    dann ewig auf eine Antwort, die nie kommen kann.
 *  - Fehlende Bindings werden als Erfolg quittiert.
 */
describe("POST /api/v1/unanswered/report", () => {
  function makeReportApp(available = true) {
    const reports: { tenantId: string; question: string; email: string | null }[] = [];
    const deps: ApiDeps = {
      resolveTenant: async (host) =>
        (host ?? "").split(":")[0].toLowerCase() === HOST ? TENANT : null,
      createAuthForTenant: async () => {
        throw new Error("nicht benötigt — der Melde-Weg ist public");
      },
      getBrandingDeps: async () => null,
      getTeamDeps: async () => null,
      getLegalDeps: async () => null,
      getContentDeps: async () => null,
      ...(available
        ? {
            getUnansweredRepo: async () => ({
              record: async () => {},
              report: async (input: { tenantId: string; question: string; email: string | null }) => {
                reports.push({
                  tenantId: input.tenantId,
                  question: input.question,
                  email: input.email,
                });
              },
              list: async () => [],
            }),
          }
        : {}),
    };
    return { app: buildApiApp(deps), reports };
  }

  const report = (app: ReturnType<typeof makeReportApp>["app"], body: unknown) =>
    app.request("/api/v1/unanswered/report", {
      method: "POST",
      headers: { host: HOST, "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  it("anonym erlaubt; Frage und freiwillige Adresse kommen an", async () => {
    const f = makeReportApp();
    const res = await report(f.app, {
      question: "Zeitgesteuerte Weiterleitung in der Fritzbox?",
      email: "Kunde@Example.COM",
    });
    expect(res.status).toBe(200);
    expect(f.reports).toEqual([
      {
        tenantId: "t_demo",
        question: "Zeitgesteuerte Weiterleitung in der Fritzbox?",
        // Kleingeschrieben gespeichert — sonst stünde dieselbe Adresse
        // mehrfach in der Liste.
        email: "kunde@example.com",
      },
    ]);
  });

  it("ohne Adresse ist in Ordnung (die Meldung zählt auch anonym)", async () => {
    const f = makeReportApp();
    expect((await report(f.app, { question: "Geht das auch ohne?" })).status).toBe(200);
    expect(f.reports[0].email).toBeNull();
  });

  it("weist Leeres, Riesiges und kaputte Adressen ab — ohne etwas zu speichern", async () => {
    const f = makeReportApp();
    expect((await report(f.app, { question: "   " })).status).toBe(400);
    expect((await report(f.app, { question: "x".repeat(401) })).status).toBe(400);

    const badEmail = await report(f.app, { question: "Gültig?", email: "keine-adresse" });
    expect(badEmail.status).toBe(400);
    expect(await badEmail.json()).toMatchObject({ error: "invalid_email" });

    expect(f.reports).toEqual([]);
  });

  it("ohne Bindings: 503 statt falschem Erfolg", async () => {
    const f = makeReportApp(false);
    expect((await report(f.app, { question: "Und jetzt?" })).status).toBe(503);
  });
});
