import type { AskAnswer, Citation } from "./types";

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
  };
  write([entry, ...read().filter((s) => s.id !== entry.id)]);
  return entry;
}

export function removeSaved(id: string): void {
  write(read().filter((s) => s.id !== id));
}

/**
 * PLATZHALTER: Sobald ein Konto verbunden ist, werden die lokal gespeicherten
 * Artikel geräteübergreifend nach D1 synchronisiert (Merge über id/savedAt).
 * Ohne Session bleibt Speichern rein lokal. Rückgabe: true, wenn synchronisiert.
 */
export async function syncSavedToAccount(): Promise<boolean> {
  return false;
}
