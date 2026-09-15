import { Hono } from "hono";
import { requireTeam } from "@/server/auth/guards";
import { MAX_ENTRY_CARDS, parseEntryCardInput } from "@/lib/content/entry-cards";
import type { ApiDeps, ApiEnv } from "./context";

/**
 * EINSTIEGS-KARTEN der Startansicht pflegen (`/admin/entry-cards`).
 *
 *   GET             /api/v1/admin/entry-cards        — Liste (in Anzeigereihenfolge)
 *   POST            /api/v1/admin/entry-cards        — anlegen (ans Ende)
 *   PUT             /api/v1/admin/entry-cards        — GANZEN Satz ersetzen
 *   PUT             /api/v1/admin/entry-cards/order  — Reihenfolge setzen
 *   PUT/DELETE      /api/v1/admin/entry-cards/:id    — ändern / löschen
 *
 * GATE: `content` — wie Changelog/Roadmap eine Inhaltsentscheidung, keine
 * Grundsatzeinstellung der Instanz.
 *
 * KEIN Index-Nachzug: Die Karten sind reine Navigation auf bereits indexierte
 * Ziele. Ein Verweis auf einen Artikel trägt kein eigenes Wissen — ihn zu
 * indexieren würde die KI-Antworten nur mit Dubletten des Artikeltitels füllen.
 *
 * Die Prüfung liegt in `lib/content/entry-cards.ts` und gilt damit
 * unverändert auch für die MCP-Tools — eine Karte, die die KI anlegen darf,
 * muss ein Mensch im Verwaltungsbereich speichern können und umgekehrt.
 */
export function entryCardsAdminRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  r.get("/", requireTeam("content"), async (c) => {
    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);
    return c.json({ cards: await content.store.listEntryCards(c.get("tenant").id) });
  });

  r.post("/", requireTeam("content"), async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: "invalid_json" }, 400);

    const card = parseEntryCardInput(parsed.body);
    if (!card.ok) return c.json({ error: card.error }, 400);

    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);

    const id = await content.store.createEntryCard(c.get("tenant").id, card.card);
    if (id === "limit") return c.json({ error: "too_many_cards", max: MAX_ENTRY_CARDS }, 409);
    return c.json({ ok: true, id }, 201);
  });

  /**
   * GANZEN Satz ersetzen. Der Weg „alle löschen, dann neu anlegen" über
   * Einzel-Requests hätte die Startseite dazwischen LEER stehen lassen —
   * sichtbar für jeden, der in diesem Moment lädt. Ein Aufruf, ein Batch.
   *
   * Auch VOR `/:id` registrieren (Hono probiert in Registrierungsreihenfolge).
   */
  r.put("/", requireTeam("content"), async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: "invalid_json" }, 400);

    const body = parsed.body as { cards?: unknown };
    if (!Array.isArray(body.cards)) return c.json({ error: "cards_required" }, 400);
    if (body.cards.length > MAX_ENTRY_CARDS) {
      return c.json({ error: "too_many_cards", max: MAX_ENTRY_CARDS }, 409);
    }

    // ALLE prüfen, bevor irgendetwas geschrieben wird.
    const cards = [];
    for (let i = 0; i < body.cards.length; i += 1) {
      const card = parseEntryCardInput(body.cards[i]);
      if (!card.ok) return c.json({ error: card.error, index: i }, 400);
      cards.push(card.card);
    }

    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);

    await content.store.replaceEntryCards(c.get("tenant").id, cards);
    return c.json({ cards: await content.store.listEntryCards(c.get("tenant").id) });
  });

  // VOR `/:id` registrieren — sonst liest Hono „order" als Karten-Id.
  r.put("/order", requireTeam("content"), async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: "invalid_json" }, 400);

    const body = parsed.body as { ids?: unknown };
    if (!Array.isArray(body.ids)) return c.json({ error: "ids_required" }, 400);
    const ids = body.ids.filter((v): v is string => typeof v === "string");
    if (ids.length !== body.ids.length || ids.length > MAX_ENTRY_CARDS) {
      return c.json({ error: "ids_required" }, 400);
    }

    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);
    const updated = await content.store.reorderEntryCards(c.get("tenant").id, ids);
    return c.json({ ok: true, updated });
  });

  r.put("/:id", requireTeam("content"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "not_found" }, 404);

    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: "invalid_json" }, 400);

    const card = parseEntryCardInput(parsed.body);
    if (!card.ok) return c.json({ error: card.error }, 400);

    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);

    const ok = await content.store.updateEntryCard(c.get("tenant").id, id, card.card);
    return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
  });

  r.delete("/:id", requireTeam("content"), async (c) => {
    const id = c.req.param("id");
    if (!id) return c.json({ error: "not_found" }, 404);

    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);

    const ok = await content.store.deleteEntryCard(c.get("tenant").id, id);
    return ok ? c.json({ ok: true }) : c.json({ error: "not_found" }, 404);
  });

  return r;
}

async function readJson(c: {
  req: { json: () => Promise<unknown> };
}): Promise<{ ok: true; body: unknown } | { ok: false }> {
  try {
    return { ok: true, body: await c.req.json() };
  } catch {
    return { ok: false };
  }
}
