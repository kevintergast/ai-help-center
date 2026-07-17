import type { ChatMessage } from "@/server/rag/generate";

/**
 * KI-ÜBERSETZUNG eines Artikels (Mehrsprachigkeit; bezahltes Feature —
 * Verbuchung macht die Route NACH Erfolg). Übersetzt Titel, Body-Blöcke und
 * Bild-Beschreibungen in EINEM Modell-Aufruf; der Modell-Aufruf selbst wird
 * injiziert (Tests: Fake).
 *
 * FORMAT-DISZIPLIN: Die Blöcke tragen das Rich-Text-Subset (##, -, 1., >,
 * ```, **…**, [Text](URL)) — die Marker und URLs MÜSSEN unverändert bleiben,
 * nur natürlicher Text wird übersetzt; Code-Blöcke bleiben komplett unberührt.
 * Ein-/Ausgabe laufen als JSON-Array gleicher Länge; stimmt die Struktur der
 * Antwort nicht, schlägt die Übersetzung fehl (KEINE Teil-Übernahme, keine
 * Credits — die Route verbucht nur Erfolg).
 */

export interface TranslateArticleInput {
  sourceLocale: string;
  targetLocale: string;
  title: string;
  body: string[];
  imageDescriptions: string[];
}

export interface TranslateArticleResult {
  title: string;
  body: string[];
  imageDescriptions: string[];
}

const LOCALE_NAMES: Record<string, string> = {
  de: "Deutsch (German)",
  en: "English",
};

export function buildTranslationMessages(input: TranslateArticleInput): ChatMessage[] {
  const source = LOCALE_NAMES[input.sourceLocale] ?? input.sourceLocale;
  const target = LOCALE_NAMES[input.targetLocale] ?? input.targetLocale;
  const payload = JSON.stringify(
    { title: input.title, body: input.body, imageDescriptions: input.imageDescriptions },
    null,
    2,
  );

  return [
    {
      role: "system",
      content:
        `Du bist ein professioneller Übersetzer für Hilfe-Dokumentation. Übersetze von ${source} nach ${target}. ` +
        "Du bekommst JSON mit title, body (Array von Blöcken) und imageDescriptions (Array). " +
        "Antworte AUSSCHLIESSLICH mit dem übersetzten JSON in exakt derselben Struktur und denselben Array-Längen. " +
        "REGELN: Markdown-Marker am Blockanfang (##, ###, -, 1., >) und Inline-Marker (**, *, `) unverändert lassen; " +
        "bei Links [Text](URL) nur den Text übersetzen, die URL exakt beibehalten; " +
        "Blöcke, die mit ``` beginnen, KOMPLETT unverändert übernehmen; " +
        "Produkt-/Eigennamen nicht übersetzen; Ton: klar und natürlich, du-Form bzw. neutrales Englisch.",
    },
    { role: "user", content: payload },
  ];
}

/** Erste JSON-Objektstruktur aus der Modell-Antwort ziehen (Modelle plaudern). */
function extractJson(raw: string): unknown {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

export class TranslationFormatError extends Error {
  constructor(reason: string) {
    super(`KI-Übersetzung unbrauchbar: ${reason}`);
    this.name = "TranslationFormatError";
  }
}

export async function translateArticle(
  generate: (messages: ChatMessage[]) => Promise<string>,
  input: TranslateArticleInput,
): Promise<TranslateArticleResult> {
  const raw = await generate(buildTranslationMessages(input));
  const parsed = extractJson(raw) as {
    title?: unknown;
    body?: unknown;
    imageDescriptions?: unknown;
  } | null;
  if (!parsed) throw new TranslationFormatError("kein JSON in der Antwort");

  const title = typeof parsed.title === "string" ? parsed.title.trim() : "";
  if (title.length === 0) throw new TranslationFormatError("Titel fehlt");

  if (!Array.isArray(parsed.body) || parsed.body.length !== input.body.length) {
    throw new TranslationFormatError("Block-Anzahl weicht ab");
  }
  const body = parsed.body.map((b, i) => {
    if (typeof b !== "string" || b.trim().length === 0) {
      throw new TranslationFormatError(`Block ${i + 1} ist leer`);
    }
    // Code-Blöcke müssen wörtlich erhalten bleiben (Regel im Prompt) —
    // fail-closed: sonst Original behalten statt kaputte Übersetzung.
    return input.body[i].startsWith("```") ? input.body[i] : b;
  });

  const descsRaw = Array.isArray(parsed.imageDescriptions) ? parsed.imageDescriptions : [];
  if (descsRaw.length !== input.imageDescriptions.length) {
    throw new TranslationFormatError("Bild-Beschreibungen weichen ab");
  }
  const imageDescriptions = descsRaw.map((d, i) => {
    if (typeof d !== "string" || d.trim().length === 0) {
      throw new TranslationFormatError(`Bild-Beschreibung ${i + 1} ist leer`);
    }
    return d;
  });

  return { title, body, imageDescriptions };
}
