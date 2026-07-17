import {
  applyStaleCheck,
  listSaved,
  mergeRemoteSaved,
  type SavedArticle,
} from "./saved-articles";

/**
 * ACCOUNT-SYNC + STALENESS-CHECK gespeicherter KI-Antworten (Client-Seite).
 *
 * Architektur: local-first — localStorage ist immer die Anzeige-Quelle; MIT
 * Konto wird zusätzlich gegen D1 gemerged (pro id gewinnt der neuere
 * savedAt-Stand). Alles hier ist fire-and-forget/best-effort: ein fehl-
 * geschlagener Sync darf das Hilfezentrum nie stören (offline, Adblocker …).
 *
 * Der Staleness-Check läuft für ALLE (auch anonyme) Nutzer über den
 * öffentlichen /answers/check — geprüft wird nur, was sourceRefs trägt.
 */

const JSON_HEADERS = { "content-type": "application/json" } as const;

async function fetchRemote(): Promise<SavedArticle[] | null> {
  try {
    const res = await fetch("/api/v1/answers", { headers: { accept: "application/json" } });
    if (!res.ok) return null;
    const data = (await res.json()) as { answers?: SavedArticle[] };
    return Array.isArray(data.answers) ? data.answers : null;
  } catch {
    return null;
  }
}

/** Antwort ins Konto schreiben (bei Speichern & nach Merge-Push). */
export function pushSavedToAccount(entry: SavedArticle): void {
  void fetch(`/api/v1/answers/${encodeURIComponent(entry.id)}`, {
    method: "PUT",
    headers: JSON_HEADERS,
    body: JSON.stringify({
      id: entry.id,
      question: entry.question,
      body: entry.body,
      citations: entry.citations,
      sourceRefs: entry.sourceRefs ?? [],
      grounded: entry.grounded,
      savedAt: entry.savedAt,
    }),
    keepalive: true,
  }).catch(() => {});
}

/** Antwort aus dem Konto löschen (bei lokalem Entfernen). */
export function deleteSavedFromAccount(id: string): void {
  void fetch(`/api/v1/answers/${encodeURIComponent(id)}`, {
    method: "DELETE",
    keepalive: true,
  }).catch(() => {});
}

/** Staleness-Prüfung aller lokalen Antworten mit Quell-Referenzen. */
async function checkStaleness(): Promise<void> {
  const withRefs = listSaved().filter((s) => (s.sourceRefs?.length ?? 0) > 0);
  if (withRefs.length === 0) return;
  try {
    const res = await fetch("/api/v1/answers/check", {
      method: "POST",
      headers: JSON_HEADERS,
      body: JSON.stringify({
        answers: withRefs.slice(0, 50).map((s) => ({ id: s.id, refs: s.sourceRefs })),
      }),
    });
    if (!res.ok) return;
    const data = (await res.json()) as { stale?: string[] };
    applyStaleCheck(
      withRefs.map((s) => s.id),
      Array.isArray(data.stale) ? data.stale : [],
    );
  } catch {
    /* best effort */
  }
}

/**
 * Einstiegspunkt (einmal pro Seiten-Mount): eingeloggt → Konto-Merge in beide
 * Richtungen, danach (immer) Staleness-Check. localStorage-Writes feuern
 * SAVED_CHANGED_EVENT → Sidebar/Listen aktualisieren sich von selbst.
 */
export async function syncSavedAnswers(loggedIn: boolean): Promise<void> {
  if (loggedIn) {
    const remote = await fetchRemote();
    if (remote) {
      const { pushCandidates } = mergeRemoteSaved(remote);
      for (const entry of pushCandidates) pushSavedToAccount(entry);
    }
  }
  await checkStaleness();
}
