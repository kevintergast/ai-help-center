import type { AskAnswer, Citation, SourceRef } from "./types";

/*
  Lokale Persistenz generierter Artikel (KI-Antworten) — local-first.
  OHNE Konto: nur hier im Browser (localStorage). MIT Konto: zusätzlich
  geräteübergreifend in D1 (syncSavedToAccount — Platzhalter bis Auth/Account
  verdrahtet sind). Siehe Memory architecture-decisions (local-first + Account-Sync).
*/

const KEY = "hh-saved-articles";

/** Feuert nach jeder Änderung (auch im selben Tab) → UI kann live nachladen. */
export const SAVED_CHANGED_EVENT = "hh-saved-changed";

export interface SavedArticle {
  id: string;
  question: string;
  body: string[];
  citations: Citation[];
  grounded: boolean;
  savedAt: number;
  /** Quell-Chunks + content_hash der Generierung (Staleness-Abgleich). */
  sourceRefs?: SourceRef[];
  /** Server-Prüfergebnis: Quellen haben sich geändert (applyStaleCheck). */
  stale?: boolean;
}

/** Stabile ID aus der Frage → dieselbe Frage wird nicht doppelt gespeichert. */
export function answerId(question: string): string {
  const norm = question.trim().toLowerCase();
  let h = 0;
  for (let i = 0; i < norm.length; i++) h = (Math.imul(31, h) + norm.charCodeAt(i)) | 0;
  return "a" + (h >>> 0).toString(36);
}

function read(): SavedArticle[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(KEY);
    const arr = raw ? (JSON.parse(raw) as SavedArticle[]) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function write(list: SavedArticle[]): void {
  try {
    window.localStorage.setItem(KEY, JSON.stringify(list));
    window.dispatchEvent(new Event(SAVED_CHANGED_EVENT));
  } catch {
    /* Speicher voll/blockiert → still ignorieren (local-first ist best effort) */
  }
}

/** Gespeicherte Artikel, neueste zuerst. */
export function listSaved(): SavedArticle[] {
  return read().sort((a, b) => b.savedAt - a.savedAt);
}

export function isSaved(id: string): boolean {
  return read().some((s) => s.id === id);
}

export function getSavedById(id: string): SavedArticle | null {
  return read().find((s) => s.id === id) ?? null;
}

export function saveAnswer(answer: AskAnswer): SavedArticle {
  const entry: SavedArticle = {
    id: answerId(answer.question),
    question: answer.question,
    body: answer.body,
    citations: answer.citations,
    grounded: answer.grounded,
    savedAt: Date.now(),
    sourceRefs: answer.sourceRefs,
  };
  write([entry, ...read().filter((s) => s.id !== entry.id)]);
  return entry;
}

export function removeSaved(id: string): void {
  write(read().filter((s) => s.id !== id));
}

/**
 * STALENESS-MARKIERUNG (Architektur: geänderte Quellen ⇒ Antwort „veraltet";
 * Nutzer entscheidet: neu generieren / behalten / löschen). `checkedIds` =
 * alles, was geprüft wurde; nur davon wird der Zustand überschrieben —
 * ungeprüfte Einträge (z. B. ohne sourceRefs) bleiben unangetastet.
 */
export function applyStaleCheck(checkedIds: string[], staleIds: string[]): void {
  const checked = new Set(checkedIds);
  const stale = new Set(staleIds);
  write(
    read().map((s) =>
      checked.has(s.id) ? { ...s, stale: stale.has(s.id) || undefined } : s,
    ),
  );
}

/** „Behalten": Veraltet-Markierung bewusst verwerfen (bis zur nächsten Quell-Änderung). */
export function keepStale(id: string): void {
  write(read().map((s) => (s.id === id ? { ...s, stale: undefined } : s)));
}

/**
 * KONTO-MERGE (Account-Sync): Remote-Stände einspielen — pro id gewinnt der
 * NEUERE savedAt; lokale neuere Stände bleiben (sie werden separat hochgepusht).
 * Rückgabe: ids, die lokal neuer sind als remote (Push-Kandidaten) + lokale
 * Einträge, die remote fehlen.
 */
export function mergeRemoteSaved(remote: SavedArticle[]): {
  pushCandidates: SavedArticle[];
} {
  const local = read();
  const byId = new Map(local.map((s) => [s.id, s]));
  const remoteById = new Map(remote.map((s) => [s.id, s]));

  let changed = false;
  for (const r of remote) {
    const l = byId.get(r.id);
    if (!l || r.savedAt > l.savedAt) {
      byId.set(r.id, { ...r, stale: l?.stale });
      changed = true;
    }
  }
  if (changed) {
    write([...byId.values()].sort((a, b) => b.savedAt - a.savedAt));
  }

  const pushCandidates = local.filter((l) => {
    const r = remoteById.get(l.id);
    return !r || l.savedAt > r.savedAt;
  });
  return { pushCandidates };
}
