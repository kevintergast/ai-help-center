import type { AnswerPart, AnswerSegment } from "@/lib/content/types";

/**
 * PROMPT-BAU + ANTWORT-PARSING für den dynamischen Hilfeartikel (RAG-Kern).
 * Reine Funktionen (getestet); der eigentliche Modell-Aufruf wird injiziert.
 *
 * Prompt-Grundsätze (Architektur-Trust-Schicht):
 *  - NUR aus den nummerierten Quellen antworten — fehlt die Info, sagen dass
 *    sie fehlt (die Grounding-Schwelle hat davor schon grob gefiltert).
 *  - In der SPRACHE DER FRAGE antworten (Architektur-Entscheidung),
 *  - strukturierte Bausteine statt Fließtext: Absätze, nummerierte Schritte
 *    und Bilder, jeder Baustein mit seiner Quelle. Erst dadurch kann die
 *    Anzeige unter jeder Aussage zeigen, WOHER sie stammt.
 *
 * WARUM JSON und nicht Prosa: Die Zuordnung Aussage → Quelle lässt sich aus
 * Fließtext nicht zurückgewinnen. Weil ein Modell aber jederzeit kaputtes
 * JSON liefern kann (das fp8-fast-Modell produziert gelegentlich Zeichensalat,
 * s. models.ts), ist der Prosa-Pfad NICHT verschwunden: `parseAnswer` fällt
 * auf Absätze zurück, wenn das Format nicht trägt. Eine schwächere Anzeige ist
 * besser als eine leere.
 */

export interface SourceImage {
  /** Bild-Id im Artikel (für die öffentliche Bild-Route). */
  id: string;
  description: string;
}

/** Ziel: Oberfläche, auf der der beschriebene Schritt ausgeführt wird. */
export interface SourceDestination {
  href: string;
  purpose: string;
}

export interface ContextChunk {
  /** 1-basierte Quellen-Nummer im Prompt. */
  index: number;
  articleTitle: string;
  text: string;
  /** Bilder dieser Quelle — das Modell darf sie über ihr Handle einsetzen. */
  images?: SourceImage[];
  /**
   * Ziele, die zu GENAU DIESEM Textblock gehören (plus die des ganzen
   * Artikels). Das Modell bekommt nur Handles; eine URL darf es nie selbst
   * schreiben — sonst schickt es Leser irgendwann auf erfundene Seiten.
   */
  destinations?: SourceDestination[];
}

export interface ChatMessage {
  role: "system" | "user";
  content: string;
}

/** Handle eines Bildes im Prompt: B<Quelle>.<Position>, z. B. „B2.1". */
function imageHandle(sourceIndex: number, position: number): string {
  return `B${sourceIndex}.${position + 1}`;
}

/** Handle eines Ziels im Prompt: Z<Quelle>.<Position>, z. B. „Z2.1". */
function destinationHandle(sourceIndex: number, position: number): string {
  return `Z${sourceIndex}.${position + 1}`;
}

export function buildAskMessages(question: string, chunks: ContextChunk[]): ChatMessage[] {
  const sources = chunks
    .map((c) => {
      const imgs = (c.images ?? [])
        .map((img, i) => `  ${imageHandle(c.index, i)}: ${img.description}`)
        .join("\n");
      const dests = (c.destinations ?? [])
        .map((d, i) => `  ${destinationHandle(c.index, i)}: ${d.purpose}`)
        .join("\n");
      return (
        `[Quelle ${c.index}] (Artikel: ${c.articleTitle})\n${c.text}` +
        (imgs ? `\nVERFÜGBARE BILDER:\n${imgs}` : "") +
        (dests ? `\nVERFÜGBARE ZIELE:\n${dests}` : "")
      );
    })
    .join("\n\n---\n\n");

  return [
    {
      role: "system",
      content:
        "Du bist der Hilfe-Assistent dieses Hilfezentrums. Beantworte die Frage " +
        "AUSSCHLIESSLICH mit Informationen aus den bereitgestellten Quellen. " +
        "Erfinde nichts; fehlt eine Information in den Quellen, sage das offen. " +
        "Antworte IMMER in der Sprache der Frage.\n\n" +
        "Antworte als JSON, ohne Text davor oder dahinter:\n" +
        '{"blocks":[{"type":"text","text":"…","source":1}]}\n\n' +
        "Regeln für die Bausteine:\n" +
        '- "text": ein kurzer Absatz. "step": EIN Schritt einer Abfolge.\n' +
        "- WANN SCHRITTE: Sobald die Antwort beschreibt, was man NACHEINANDER " +
        'tut, nimm "step" — auch wenn die Frage das Wort Schritt nicht ' +
        'enthält. Fragen der Form „Wie mache ich X?" sind fast immer ein ' +
        "Ablauf. Ein Schritt pro Baustein, in der richtigen Reihenfolge, und " +
        "nummeriere NICHT selbst — das macht die Anzeige. Nur was wirklich " +
        'keine Abfolge ist (eine Erklärung, eine Einordnung), bleibt "text".\n' +
        '  Beispiel für „Wie lege ich ein Konto an?“:\n' +
        '  {"blocks":[{"type":"step","text":"Öffne die Registrierung und gib ' +
        'deine Adresse ein.","source":1},{"type":"step","text":"Bestätige die ' +
        'E-Mail über den Link.","source":1}]}\n' +
        '- "source" ist die Nummer der Quelle, aus der dieser Baustein stammt. ' +
        "Jeder Baustein braucht genau eine. Keine Quellennummern im Text.\n" +
        '- "image": nur wenn ein Bild den Schritt wirklich zeigt. Dann ' +
        '{"type":"image","image":"B1.2","source":1} mit einem Handle aus ' +
        "VERFÜGBARE BILDER. Erfinde keine Handles und wiederhole kein Bild.\n" +
        "- ZIELE sind Oberflächen, auf denen der Schritt wirklich ausgeführt " +
        "wird. Nenne sie NIE als Adresse, sondern über ihr Handle, und nur " +
        "wenn VERFÜGBARE ZIELE eines anbietet, das zum Schritt passt. Zwei " +
        "Arten, es zu nutzen:\n" +
        '  a) Im Satz: schreibe [Beschriftung](Z1.1) mitten in den Text, ' +
        'etwa „öffne die [Assistenten-Einstellungen](Z1.1) und …“.\n' +
        '  b) Als eigener Knopf hinter dem Schritt: ' +
        '{"type":"link","to":"Z1.1","label":"Einstellungen öffnen","source":1}\n' +
        "  Nimm a), wenn der Weg Teil des Satzes ist; b), wenn der Schritt mit " +
        "dem Öffnen der Seite endet. Höchstens ein Knopf je Schritt.\n" +
        "- Höchstens 8 Bausteine. Kein Markdown, keine Überschriften, keine " +
        "Aufzählungszeichen — der Text eines Bausteins ist reiner Fließtext " +
        "(die Ziel-Schreibweise oben ist die EINZIGE Ausnahme).",
    },
    {
      role: "user",
      content: `QUELLEN:\n\n${sources}\n\nFRAGE: ${question}`,
    },
  ];
}

/** Maximal angezeigte Bausteine (Schutz vor Modell-Weitschweifigkeit). */
const MAX_PARAGRAPHS = 8;

/**
 * Modelltext → Anzeige-Absätze: an Leerzeilen trennen, Markdown-Reste
 * (Überschriften-#, Listen-Marker, **fett**-Sterne) entschärfen, leere Teile
 * verwerfen. Einzelne Zeilenumbrüche innerhalb eines Absatzes werden zu
 * Leerzeichen (Modelle brechen gern hart um).
 */
export function splitAnswerParagraphs(raw: string): string[] {
  return raw
    .replace(/\r\n/g, "\n")
    .split(/\n\s*\n/)
    .map((block) =>
      block
        .split("\n")
        .map((line) => line.replace(/^\s*(#{1,6}\s+|[-*]\s+|\d+[.)]\s+)/, "").trim())
        .filter((line) => line.length > 0)
        .join(" ")
        .replace(/\*\*([^*]+)\*\*/g, "$1")
        .trim(),
    )
    .filter((p) => p.length > 0)
    .slice(0, MAX_PARAGRAPHS);
}

/**
 * Alle VOLLSTÄNDIGEN `{…}`-Objekte ab `from` einsammeln.
 *
 * Bewusst objektweise statt „ein großes Objekt oder nichts": Reißt die
 * Ausgabe am Token-Limit ab, sind die bis dahin geschriebenen Bausteine
 * vollständig und brauchbar — nur der angefangene letzte fehlt. Vorher ging
 * in dem Fall ALLES verloren und der Rohtext landete beim Leser.
 */
function completeObjects(raw: string, from: number): string[] {
  const out: string[] = [];
  let depth = 0;
  let start = -1;
  let inString = false;
  let escaped = false;
  for (let i = from; i < raw.length; i++) {
    const ch = raw[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (ch === "\\") escaped = true;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "{") {
      if (depth === 0) start = i;
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0 && start >= 0) {
        out.push(raw.slice(start, i + 1));
        start = -1;
      }
      if (depth < 0) break; // schließende Klammer des Umschlags
    }
  }
  return out;
}

/**
 * Bausteine aus der Modellausgabe holen — erst der saubere Weg, dann die
 * Rettung abgeschnittener Ausgaben.
 */
function extractBlocks(raw: string): unknown[] | null {
  const marker = raw.indexOf('"blocks"');
  if (marker < 0) return null;
  const arrayStart = raw.indexOf("[", marker);
  if (arrayStart < 0) return null;

  // Sauberer Fall: das ganze Array steht da.
  const whole = raw.slice(arrayStart);
  const end = whole.lastIndexOf("]");
  if (end > 0) {
    try {
      const parsed = JSON.parse(whole.slice(0, end + 1)) as unknown;
      if (Array.isArray(parsed)) return parsed;
    } catch {
      /* abgeschnitten oder verunglückt → objektweise retten */
    }
  }

  const salvaged: unknown[] = [];
  for (const obj of completeObjects(raw, arrayStart)) {
    try {
      salvaged.push(JSON.parse(obj));
    } catch {
      /* einzelnes kaputtes Objekt überspringen */
    }
  }
  return salvaged.length > 0 ? salvaged : null;
}

/**
 * Sieht der Rohtext nach UNSEREM Format aus?
 *
 * Entscheidend für den Rückfall: Rohes JSON darf NIE als Antwort erscheinen
 * (Live-Fund 2026-10-14 — genau das stand in Produktion im Artikel). Lieber
 * gar keine Antwort mit dem Angebot, sich zu melden, als eine Seite voller
 * Feldnamen und Klammern.
 */
function looksLikeBlockJson(raw: string): boolean {
  const head = raw.trimStart().slice(0, 400);
  return head.startsWith("{") || head.includes('"blocks"') || head.includes('"type":"');
}

/** Text eines Bausteins säubern — dieselben Markdown-Reste wie im Prosa-Pfad. */
function cleanText(value: unknown): string {
  if (typeof value !== "string") return "";
  return value
    .replace(/\s*\n\s*/g, " ")
    .replace(/^\s*(#{1,6}\s+|[-*]\s+|\d+[.)]\s+)/, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .trim();
}

export interface AnswerSourceSpec {
  /** 1-basierte Quellen-Nummer wie im Prompt. */
  index: number;
  /** Index derselben Quelle in `citations` der fertigen Antwort. */
  citationIndex: number;
  images: SourceImage[];
  destinations: SourceDestination[];
}

/**
 * Handle → Adresse. `Z<Quelle>.<Position>`; unbekannte Handles liefern
 * `null` und werden vom Aufrufer verworfen — ein erfundenes Ziel darf nie
 * als Link beim Leser landen.
 */
function resolveDestination(handle: string, sources: AnswerSourceSpec[]): string | null {
  const m = /^Z(\d+)\.(\d+)$/.exec(handle.trim());
  if (!m) return null;
  const spec = sources.find((x) => x.index === Number(m[1]));
  return spec?.destinations[Number(m[2]) - 1]?.href ?? null;
}

/**
 * JEDE Link-Schreibweise im Satz — nicht nur unsere Handles.
 *
 * Absicht: Schreibt das Modell `[hier](https://irgendwo)`, soll weder die
 * Adresse noch die Klammer-Schreibweise beim Leser landen. Aufgelöst wird
 * nur ein Z-Handle; bei allem anderen bleibt die Beschriftung als normaler
 * Text übrig. So kann das Modell auf keinem Weg eine eigene Adresse
 * unterbringen, auch nicht als unklickbaren Text.
 */
const INLINE_LINK_RE = /\[([^\]\n]{1,80})\]\(([^)\s]{1,2048})\)/g;

/**
 * Text mit Inline-Zielen → Segmente plus reiner Text.
 *
 * Unbekanntes Handle ⇒ die Beschriftung bleibt als normaler Text stehen. So
 * sieht der Leser nie eine Klammer-Schreibweise und nie einen toten Link —
 * im schlechtesten Fall fehlt ihm nur der Sprung.
 */
function splitInlineLinks(
  raw: string,
  sources: AnswerSourceSpec[],
): { text: string; segments?: AnswerSegment[] } {
  INLINE_LINK_RE.lastIndex = 0;
  const segments: AnswerSegment[] = [];
  let plain = "";
  let last = 0;
  let linked = false;
  for (let m = INLINE_LINK_RE.exec(raw); m !== null; m = INLINE_LINK_RE.exec(raw)) {
    const before = raw.slice(last, m.index);
    if (before) {
      segments.push({ text: before });
      plain += before;
    }
    const href = resolveDestination(m[2], sources);
    segments.push(href ? { text: m[1], href } : { text: m[1] });
    if (href) linked = true;
    plain += m[1];
    last = m.index + m[0].length;
  }
  const rest = raw.slice(last);
  if (rest) {
    segments.push({ text: rest });
    plain += rest;
  }
  return linked ? { text: plain, segments } : { text: plain };
}

/**
 * Modellausgabe → Bausteine. Fällt auf Absätze zurück, wenn kein brauchbares
 * JSON kommt; liefert in JEDEM Fall `body` (die Texte), damit gespeicherte
 * Antworten und ältere Clients unverändert funktionieren.
 *
 * STRENG bei Verweisen: Eine Quellen-Nummer, die es nicht gibt, wird
 * verworfen statt geraten — ein falsch zugeordneter Beleg ist schlimmer als
 * gar keiner. Dasselbe für Bild-Handles: Nur Bilder, die wirklich zu dieser
 * Quelle gehören, werden eingesetzt.
 */
export function parseAnswer(
  raw: string,
  sources: AnswerSourceSpec[],
): { body: string[]; parts?: AnswerPart[] } {
  const blocks = extractBlocks(raw);
  if (!blocks) return { body: proseFallback(raw) };

  const byIndex = new Map(sources.map((s) => [s.index, s]));
  const usedImages = new Set<string>();
  const parts: AnswerPart[] = [];

  for (const entry of blocks) {
    if (parts.length >= MAX_PARAGRAPHS) break;
    if (!entry || typeof entry !== "object") continue;
    const o = entry as Record<string, unknown>;
    const spec = typeof o.source === "number" ? byIndex.get(o.source) : undefined;

    if (o.type === "image") {
      // Ein Bild OHNE gültige Quelle hat keine Adresse — es ließe sich nicht
      // einmal laden (die Bild-Route braucht den Artikel-Slug der Quelle).
      if (!spec || typeof o.image !== "string") continue;
      const pos = Number.parseInt(o.image.split(".")[1] ?? "", 10) - 1;
      const img = spec.images[pos];
      if (!img || usedImages.has(img.id)) continue;
      usedImages.add(img.id);
      parts.push({
        kind: "image",
        imageId: img.id,
        alt: img.description,
        source: spec.citationIndex,
      });
      continue;
    }

    if (o.type === "link") {
      // Knopf hinter dem Schritt. Ohne auflösbares Handle KEIN Knopf — das
      // Modell darf keine Adresse erfinden.
      const href = typeof o.to === "string" ? resolveDestination(o.to, sources) : null;
      const label = cleanText(o.label);
      if (!href || label.length === 0 || label.length > 80) continue;
      parts.push({
        kind: "link",
        href,
        label,
        ...(spec ? { source: spec.citationIndex } : {}),
      });
      continue;
    }

    const { text, segments } = splitInlineLinks(cleanText(o.text), sources);
    if (text.length === 0) continue;
    parts.push({
      kind: o.type === "step" ? "step" : "text",
      text,
      ...(segments ? { segments } : {}),
      ...(spec ? { source: spec.citationIndex } : {}),
    });
  }

  // Nur Bilder (oder nichts) ist keine Antwort — dann lieber der Prosa-Pfad.
  const body = parts
    .filter((p): p is Extract<AnswerPart, { text: string }> => p.kind === "text" || p.kind === "step")
    .map((p) => p.text);
  if (body.length === 0) return { body: proseFallback(raw) };

  return { body, parts };
}

/**
 * Rückfall, wenn sich keine Bausteine lesen lassen: Prosa — ABER nur, wenn
 * der Rohtext auch wirklich Prosa ist. Nach unserem Format aussehender Text
 * wird verworfen; die Routen behandeln ein leeres `body` als „keine Antwort"
 * und bieten dem Fragenden den Weg zum Support an.
 */
function proseFallback(raw: string): string[] {
  return looksLikeBlockJson(raw) ? [] : splitAnswerParagraphs(raw);
}
