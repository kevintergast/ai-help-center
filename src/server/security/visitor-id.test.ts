import { describe, expect, it } from "vitest";
import { ipKey, langKey, makeVisitorIdCodec, uaKey, type VisitorSignals } from "./visitor-id";

/**
 * Cookiefreie Besucher-IDs. Die MAU ist eine HARTE Plan-Grenze, deshalb ist
 * jede ÜBERzählung der teure Fehler: Sie drängt einen Kunden zu Unrecht ins
 * Upgrade. Die Tests halten genau die Stabilität fest, die das verhindert —
 * dazu die Eigenschaften, an denen der Datenschutz hängt.
 */

const BASE: VisitorSignals = {
  ip: "203.0.113.7",
  userAgent: "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/131.0.6778.86 Safari/537.36",
  acceptLanguage: "de-DE,de;q=0.9,en;q=0.8",
  platform: '"Windows"',
  mobile: "?0",
};

describe("ipKey — Adresse auf den stabilen Teil", () => {
  /**
   * Verhinderter Fehlerfall: IPv6-Privacy-Extensions würfeln die hinteren
   * 64 Bit mehrmals täglich neu. Mit voller Adresse zählte derselbe
   * Anschluss im Monat dutzendfach.
   */
  it("kürzt IPv6 auf das /64 des Anschlusses", () => {
    const a = ipKey("2001:db8:1234:5678:aaaa:bbbb:cccc:dddd");
    const b = ipKey("2001:db8:1234:5678:1111:2222:3333:4444");
    expect(a).toBe("2001:db8:1234:5678");
    expect(b).toBe(a);
  });

  it("versteht die Kurzschreibweise", () => {
    expect(ipKey("2001:db8::1")).toBe("2001:db8:0:0");
    expect(ipKey("::1")).toBe("0:0:0:0");
    expect(ipKey("2001:0db8:0000:0001:2:3:4:5")).toBe("2001:db8:0:1");
  });

  it("lässt IPv4 ganz (ein /24 wäre kein Anschluss, sondern ein Provider-Pool)", () => {
    expect(ipKey("203.0.113.7")).toBe("203.0.113.7");
    expect(ipKey("::ffff:203.0.113.7")).toBe("203.0.113.7");
  });

  it("trennt verschiedene Anschlüsse weiterhin", () => {
    expect(ipKey("2001:db8:1234:5678::1")).not.toBe(ipKey("2001:db8:1234:9999::1"));
  });
});

describe("uaKey — Haupt-Version statt voller Version", () => {
  /**
   * Verhinderter Fehlerfall: Chrome aktualisiert sich etwa alle vier Wochen.
   * Mit voller Versionsnummer bekäme ein großer Teil ALLER Besucher mitten
   * im Monat eine neue Kennung — eine Überzählung, die jeden Monat
   * zuverlässig wiederkehrt.
   */
  it("überlebt ein Browser-Update im laufenden Monat", () => {
    const vorher = uaKey("Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0.6778.86 Safari/537.36");
    const nachher = uaKey("Mozilla/5.0 (X11; Linux x86_64) Chrome/131.0.6999.12 Safari/537.36");
    expect(nachher).toBe(vorher);
  });

  it("unterscheidet aber echte Haupt-Versionen und Browser", () => {
    expect(uaKey("Chrome/131.0.1.1")).not.toBe(uaKey("Chrome/132.0.1.1"));
    expect(uaKey("Chrome/131.0.1.1")).not.toBe(uaKey("Firefox/131.0.1.1"));
  });
});

describe("langKey — nur das erste Tag", () => {
  it("wirft die Gewichtungsliste weg (die variiert je Aufruf)", () => {
    expect(langKey("de-DE,de;q=0.9,en;q=0.8")).toBe("de-de");
    expect(langKey("de-DE,en;q=0.5")).toBe("de-de");
  });
});

describe("Ableitung", () => {
  const codec = makeVisitorIdCodec("test-secret-mindestens-lang-genug");
  const base = { tenantId: "t_a", period: "2026-09", signals: BASE };

  it("ist innerhalb derselben Periode stabil (MAU-Dedup)", async () => {
    expect(await codec.derive(base)).toBe(await codec.derive({ ...base }));
  });

  it("wechselt mit der Periode (keine Verknüpfung über Monate)", async () => {
    expect(await codec.derive({ ...base, period: "2026-10" })).not.toBe(await codec.derive(base));
  });

  it("wechselt mit dem Mandanten (kein Cross-Tenant-Wiedererkennen)", async () => {
    expect(await codec.derive({ ...base, tenantId: "t_b" })).not.toBe(await codec.derive(base));
  });

  it("trennt die Merkmale eindeutig voneinander", async () => {
    // Ohne Trenner wären („1.2.3", „4Mozilla") und („1.2.34", „Mozilla")
    // dieselbe Eingabe — zwei Besucher fielen zu einem zusammen.
    const a = await codec.derive({
      ...base,
      signals: { ...BASE, ip: "1.2.3", userAgent: "4Mozilla" },
    });
    const b = await codec.derive({
      ...base,
      signals: { ...BASE, ip: "1.2.34", userAgent: "Mozilla" },
    });
    expect(a).not.toBe(b);
  });

  it("unterscheidet Gerät, Sprache und Plattform", async () => {
    const id = await codec.derive(base);
    for (const change of [
      { ip: "198.51.100.9" },
      { userAgent: "Safari/17.0" },
      { acceptLanguage: "en-US,en" },
      { platform: '"macOS"' },
      { mobile: "?1" },
    ]) {
      expect(await codec.derive({ ...base, signals: { ...BASE, ...change } })).not.toBe(id);
    }
  });

  it("verschiedene Secrets erzeugen unverknüpfbare IDs", async () => {
    const other = makeVisitorIdCodec("ein-ganz-anderes-secret-wert");
    expect(await other.derive(base)).not.toBe(await codec.derive(base));
  });

  it("gibt kein Klartext-Merkmal preis", async () => {
    const id = await codec.derive(base);
    expect(id).not.toContain(BASE.ip);
    expect(id).not.toContain("Chrome");
    expect(id).toMatch(/^[A-Za-z0-9_-]{22}$/);
  });
});
