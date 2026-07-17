import { describe, expect, it } from "vitest";
import { parseCreateArticle, parseYouTubeId, RESERVED_SLUGS } from "./validate";

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


describe("parseYouTubeId — URL-Formen + Ablehnung (v1: nur YouTube)", () => {
  it("akzeptiert ID und alle üblichen URL-Formen", () => {
    for (const input of [
      "jNQXAC9IVRw",
      "https://www.youtube.com/watch?v=jNQXAC9IVRw",
      "https://youtube.com/watch?v=jNQXAC9IVRw&t=42s",
      "https://youtu.be/jNQXAC9IVRw?si=abc",
      "https://m.youtube.com/watch?v=jNQXAC9IVRw",
      "https://www.youtube.com/shorts/jNQXAC9IVRw",
      "https://www.youtube.com/embed/jNQXAC9IVRw",
      "https://www.youtube-nocookie.com/embed/jNQXAC9IVRw",
      "https://www.youtube.com/live/jNQXAC9IVRw",
    ]) {
      expect(parseYouTubeId(input), input).toBe("jNQXAC9IVRw");
    }
  });

  it("lehnt fremde Hosts, Müll und gefährliche Schemata ab", () => {
    for (const input of [
      "https://vimeo.com/12345678",
      "https://evil.example/watch?v=jNQXAC9IVRw",
      "javascript:alert(1)",
      "nur text",
      "https://youtu.be/zukurz",
      "",
    ]) {
      expect(parseYouTubeId(input), input).toBeNull();
    }
  });
});

describe("parseCreateArticle — Videos brauchen YouTube-Quelle", () => {
  const base = { slug: "video-test", title: "T", category: "K", body: ["Absatz."] };

  it("youtubeUrl wird zur ID normalisiert; ohne Quelle → 400", () => {
    const ok = parseCreateArticle(
      {
        ...base,
        videos: [
          {
            id: "v1",
            title: "Rundgang",
            description: "Zeigt die Einrichtung",
            youtubeUrl: "https://youtu.be/jNQXAC9IVRw",
          },
        ],
      },
      "de",
    );
    expect(ok.ok).toBe(true);
    if (ok.ok) {
      expect(ok.value.videos[0].youtubeId).toBe("jNQXAC9IVRw");
      expect(ok.value.videos[0].durationLabel).toBe("");
    }

    const missing = parseCreateArticle(
      { ...base, videos: [{ id: "v1", title: "x", description: "d" }] },
      "de",
    );
    expect(missing).toMatchObject({ ok: false, error: "youtube_url_invalid" });
  });
});
