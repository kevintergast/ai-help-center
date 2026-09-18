import { Hono } from "hono";
import { requireTeam } from "@/server/auth/guards";
import { MAX_ENTRY_CARDS, parseEntryCardInput } from "@/lib/content/entry-cards";
import { MAX_CONTACT_METHODS, parseContactMethodInput } from "@/lib/content/contact-methods";
import { MAX_ACTION_BUTTONS, parseActionButtonInput } from "@/lib/content/action-buttons";
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

/**
 * KONTAKTWEGE pflegen (`/admin/contact-methods`).
 *
 *   GET  /api/v1/admin/contact-methods   — Liste (Anzeigereihenfolge)
 *   PUT  /api/v1/admin/contact-methods   — GANZEN Satz ersetzen
 *
 * Nur Ersetzen, kein Einzel-CRUD: Bei höchstens sechs Karten ist „hier ist der
 * neue Stand" einfacher und atomar. Zwischenstände wären auf einer Seite
 * sichtbar, die Endnutzer aufrufen, wenn sie ohnehin schon nicht weiterkommen.
 *
 * GATE `content` wie die übrige Inhaltspflege. Die Seite erscheint genau dann,
 * wenn mindestens ein Weg gepflegt ist — es gibt bewusst keinen zweiten
 * Schalter, der damit aus dem Tritt geraten könnte.
 */
export function contactMethodsAdminRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  r.get("/", requireTeam("content"), async (c) => {
    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);
    return c.json({ methods: await content.store.listContactMethods(c.get("tenant").id) });
  });

  r.put("/", requireTeam("content"), async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: "invalid_json" }, 400);

    const body = parsed.body as { methods?: unknown };
    if (!Array.isArray(body.methods)) return c.json({ error: "methods_required" }, 400);
    if (body.methods.length > MAX_CONTACT_METHODS) {
      return c.json({ error: "too_many_methods", max: MAX_CONTACT_METHODS }, 409);
    }

    // ALLE prüfen, bevor irgendetwas geschrieben wird.
    const methods = [];
    for (let i = 0; i < body.methods.length; i += 1) {
      const m = parseContactMethodInput(body.methods[i]);
      if (!m.ok) return c.json({ error: m.error, index: i }, 400);
      methods.push(m.method);
    }

    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);

    await content.store.replaceContactMethods(c.get("tenant").id, methods);
    return c.json({ methods: await content.store.listContactMethods(c.get("tenant").id) });
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

/**
 * AKTIONS-KNÖPFE im Kopf pflegen (`/admin/header-actions`).
 *
 *   GET  /api/v1/admin/header-actions   — Liste (Anzeigereihenfolge)
 *   PUT  /api/v1/admin/header-actions   — GANZEN Satz ersetzen
 *
 * Nur Ersetzen wie bei Karten und Kontaktwegen: Bei höchstens drei Knöpfen ist
 * „hier ist der neue Stand" einfacher und atomar. Sie stehen im Kopf JEDER
 * Seite — ein Zwischenzustand wäre sofort überall sichtbar.
 */
export function headerActionsAdminRouter(deps: ApiDeps) {
  const r = new Hono<ApiEnv>();

  r.get("/", requireTeam("content"), async (c) => {
    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);
    return c.json({ buttons: await content.store.listHeaderActions(c.get("tenant").id) });
  });

  r.put("/", requireTeam("content"), async (c) => {
    const parsed = await readJson(c);
    if (!parsed.ok) return c.json({ error: "invalid_json" }, 400);

    const body = parsed.body as { buttons?: unknown };
    if (!Array.isArray(body.buttons)) return c.json({ error: "buttons_required" }, 400);
    if (body.buttons.length > MAX_ACTION_BUTTONS) {
      return c.json({ error: "too_many_buttons", max: MAX_ACTION_BUTTONS }, 409);
    }

    const buttons = [];
    for (let i = 0; i < body.buttons.length; i += 1) {
      const b = parseActionButtonInput(body.buttons[i]);
      if (!b.ok) return c.json({ error: b.error, index: i }, 400);
      buttons.push(b.button);
    }

    const content = await deps.getContentDeps();
    if (!content) return c.json({ error: "content_unavailable" }, 503);

    await content.store.replaceHeaderActions(c.get("tenant").id, buttons);
    return c.json({ buttons: await content.store.listHeaderActions(c.get("tenant").id) });
  });

  return r;
}
