import type { ArticleExportFile } from "@/server/content/transfer";

/**
 * BEISPIELDATEIEN für den Import-Dialog („Beispiel herunterladen") — bewusst
 * CLIENT-SICHER (nur Typ-Import, kein Server-Code im Bundle). Die UI-Doku IST
 * dieser Code: transfer.test.ts schickt beide Beispiele durch die ECHTEN
 * Parser — die Doku kann damit nie vom tatsächlichen Format driften.
 */

export function buildExampleImportFile(): ArticleExportFile {
  return {
    format: "hallofhelp/articles@1",
    exportedAt: "2026-01-01T00:00:00.000Z",
    articles: [
      {
        slug: "erste-schritte",
        title: "Erste Schritte",
        category: "Los geht's",
        locale: "de",
        status: "draft",
        body: [
          "Ein Absatz ist ein Eintrag in `body`.",
          "## Zwischenüberschriften gehen mit zwei Rauten",
          "- Listen\n- gehen\n- so",
          "Auch **fett**, *kursiv* und [Links](https://example.com) funktionieren.",
        ],
        videos: [
          {
            id: "v-rundgang",
            title: "Rundgang durchs Produkt",
            durationLabel: "2:30",
            description: "Kurzer Überblick über die wichtigsten Funktionen.",
            // v1 unterstützt nur YouTube — youtubeId ODER youtubeUrl ist Pflicht.
            youtubeId: "dQw4w9WgXcQ",
          },
        ],
        relatedSlugs: ["konto-anlegen"],
        readingMinutes: 3,
        images: [{ description: "Screenshot: Dashboard nach dem ersten Login" }],
      },
      {
        slug: "konto-anlegen",
        title: "Konto anlegen",
        category: "Los geht's",
        locale: "de",
        status: "draft",
        body: ["Registrieren, E-Mail bestätigen, fertig."],
        videos: [],
        relatedSlugs: [],
        readingMinutes: 1,
        images: [],
      },
    ],
  };
}

export const EXAMPLE_IMPORT_MARKDOWN = `---
slug: erste-schritte
category: Los geht's
locale: de
---

# Erste Schritte

Ein Absatz ist ein Block zwischen Leerzeilen.

## Zwischenüberschriften gehen mit zwei Rauten

- Listen
- gehen
- so

Auch **fett**, *kursiv* und [Links](https://example.com) funktionieren.

![Screenshot: Dashboard nach dem ersten Login](dashboard.png)
`;
