import { describe, expect, it } from "vitest";
import { parseCreateArticle, RESERVED_SLUGS } from "./validate";

/**
 * Regressionsschutz für die Reserved-Slug-Regel: Artikel-Slugs teilen sich den
 * Namensraum mit expliziten App-Routen (`/login`, `/admin`, …). Next priorisiert
 * die expliziten Routen vor `/<slug>` → ein Artikel mit so einem Slug wäre über
 * seine URL NIE erreichbar. Das Anlegen muss daher fehlschlagen.
 */
describe("parseCreateArticle — Slug-Regeln", () => {
  const base = { title: "Titel", category: "Kategorie", body: ["Absatz."] };

  it("lehnt reservierte Slugs ab (würden von App-Routen verdeckt)", () => {
    for (const slug of RESERVED_SLUGS) {
      const res = parseCreateArticle({ ...base, slug }, "de");
      expect(res.ok, `Slug '${slug}' hätte abgelehnt werden müssen`).toBe(false);
      if (!res.ok) {
        expect(res.error).toBe("reserved_slug");
        expect(res.status).toBe(400);
      }
    }
  });

  it("akzeptiert einen normalen, nicht reservierten Slug", () => {
    const res = parseCreateArticle({ ...base, slug: "was-ist-hallofhelp" }, "de");
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.value.slug).toBe("was-ist-hallofhelp");
      expect(res.value.locale).toBe("de");
    }
  });

  it("lehnt ungültige Slug-Formate weiterhin ab (Großschrift/Leerzeichen)", () => {
    for (const slug of ["Login", "hallo welt", "-vorne", "doppel--strich"]) {
      const res = parseCreateArticle({ ...base, slug }, "de");
      expect(res.ok, `Slug '${slug}' hätte abgelehnt werden müssen`).toBe(false);
    }
  });
});
