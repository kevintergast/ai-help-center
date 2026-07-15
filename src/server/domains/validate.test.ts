import { describe, expect, it } from "vitest";
import { normalizeCustomDomain, txtRecordName } from "./validate";
import { makeTxtChecker } from "./verify";

/**
 * Domain-Validierung + DoH-TXT-Parsing (Infra-Plan Schritt 5). Verhinderte
 * Fehlerfälle: eigene Zone als „Kunden-Domain" (Slug-Routing-Hijack), URL-/
 * Scheme-Schmuggel im Hostname, Bindestrich-Domains fälschlich abgelehnt,
 * gequotete/mehrteilige TXT-Antworten nicht erkannt, Resolver-Ausfall
 * verifiziert fälschlich (fail-open).
 */

describe("normalizeCustomDomain", () => {
  it("akzeptiert normale Domains inkl. Bindestrich/Subdomain/Punycode + normalisiert", () => {
    expect(normalizeCustomDomain("Hilfe.Kunde.DE.")).toEqual({ ok: true, domain: "hilfe.kunde.de" });
    expect(normalizeCustomDomain("my-shop.example.co.uk")).toMatchObject({ ok: true });
    expect(normalizeCustomDomain("xn--hilfe-kchen-vlb.de")).toMatchObject({ ok: true });
  });

  it("lehnt kaputte/URL-artige Eingaben ab", () => {
    for (const bad of [
      "kunde",
      "https://kunde.de",
      "kunde.de/pfad",
      "kunde .de",
      "-kunde.de",
      "kunde-.de",
      "1.2.3.4",
      "a".repeat(64) + ".de",
      42,
      null,
    ]) {
      expect(normalizeCustomDomain(bad)).toEqual({ ok: false, error: "invalid_domain" });
    }
  });

  it("reserviert: eigene Zonen sind nie beanspruchbar (Slug-Routing-Schutz)", () => {
    for (const reserved of [
      "hallofhelp.com",
      "demo.hallofhelp.com",
      "auth.hallofhelp.com",
      "boese.workers.dev",
      "app.localhost",
    ]) {
      expect(normalizeCustomDomain(reserved)).toEqual({ ok: false, error: "reserved_domain" });
    }
  });

  it("txtRecordName: fester Prefix", () => {
    expect(txtRecordName("hilfe.kunde.de")).toBe("_hallofhelp-verify.hilfe.kunde.de");
  });
});

describe("makeTxtChecker — DoH-Parsing + fail-closed", () => {
  const doh = (payload: unknown, ok = true): typeof fetch =>
    (async () =>
      new Response(JSON.stringify(payload), {
        status: ok ? 200 : 500,
        headers: { "content-type": "application/dns-json" },
      })) as typeof fetch;

  it("gequotete und mehrteilige TXT-Werte werden erkannt", async () => {
    const token = "hoh-verify-abc123";
    const single = makeTxtChecker(doh({ Status: 0, Answer: [{ type: 16, data: `"${token}"` }] }));
    expect(await single("kunde.de", token)).toBe("verified");

    const multi = makeTxtChecker(
      doh({ Status: 0, Answer: [{ type: 16, data: `"hoh-verify-" "abc123"` }] }),
    );
    expect(await multi("kunde.de", token)).toBe("verified");
  });

  it("fremder TXT → mismatch; kein Record → not_found", async () => {
    const other = makeTxtChecker(doh({ Status: 0, Answer: [{ type: 16, data: `"anderes"` }] }));
    expect(await other("kunde.de", "hoh-verify-x")).toBe("mismatch");

    const nx = makeTxtChecker(doh({ Status: 3 }));
    expect(await nx("kunde.de", "hoh-verify-x")).toBe("not_found");
  });

  it("Resolver-Fehler/HTTP-Fehler → dns_error (NIE verified)", async () => {
    const brokenHttp = makeTxtChecker(doh({}, false));
    expect(await brokenHttp("kunde.de", "t")).toBe("dns_error");

    const throwing = makeTxtChecker((async () => {
      throw new Error("net");
    }) as typeof fetch);
    expect(await throwing("kunde.de", "t")).toBe("dns_error");
  });
});
