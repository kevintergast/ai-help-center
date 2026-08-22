import { describe, expect, it } from "vitest";
import { GET } from "./route";

/**
 * WIDGET-LOADER: der ausgelieferte Code wird hier WIRKLICH ausgeführt — gegen
 * einen winzigen DOM-Stub statt jsdom (keine neue Dependency). Verhinderte
 * Fehlerfälle:
 *  - Loader wird dynamisch eingefügt (Google Tag Manager, React-Hoisting eines
 *    <script async>, unser eigenes Hilfezentrum via 0027): `document.currentScript`
 *    ist dann null → ohne Fallback erschiene das Widget NIE, ohne jede Fehlermeldung.
 *  - Origin-Ableitung greift auf den Script-Host, nicht auf die Gastgeber-Seite
 *    (sonst lädt das iframe von der Kunden-Domain → 404 statt Chat).
 *  - Doppelte Einbindung montiert zwei Launcher übereinander.
 */

interface StubEl {
  tag: string;
  src?: string;
  style: { cssText: string };
  attrs: Record<string, string>;
  setAttribute(name: string, value: string): void;
  addEventListener(type: string, fn: () => void): void;
  innerHTML: string;
  type?: string;
}

function makeDom(opts: { currentScript?: boolean; scriptInDom?: boolean } = {}) {
  const { currentScript = false, scriptInDom = true } = opts;
  const SRC = "https://demo.hallofhelp.com/widget.js";
  const mounted: StubEl[] = [];

  const el = (tag: string): StubEl => ({
    tag,
    style: { cssText: "" },
    attrs: {},
    setAttribute(name, value) {
      this.attrs[name] = value;
    },
    addEventListener() {},
    innerHTML: "",
  });

  const scriptTag = { ...el("script"), src: SRC };
  const document = {
    currentScript: currentScript ? scriptTag : null,
    querySelectorAll: (sel: string) =>
      sel.includes("widget.js") && scriptInDom ? [scriptTag] : [],
    createElement: el,
    addEventListener: () => {},
    body: { appendChild: (node: StubEl) => mounted.push(node) },
  };
  const window: Record<string, unknown> = { addEventListener: () => {} };
  return { document, window, mounted };
}

async function loaderSource(): Promise<string> {
  return await GET().text();
}

function run(src: string, dom: ReturnType<typeof makeDom>) {
  new Function("window", "document", src)(dom.window, dom.document);
}

describe("GET /widget.js", () => {
  it("liefert JavaScript mit nosniff und endlicher Cache-Zeit", async () => {
    const res = GET();
    expect(res.headers.get("content-type")).toContain("text/javascript");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    // Cachebar, aber NICHT immutable: der Loader muss updatebar bleiben.
    expect(res.headers.get("cache-control")).toBe("public, max-age=3600");
  });

  it("montiert Button + iframe OHNE currentScript (Tag-Manager / React-Hoisting)", async () => {
    const dom = makeDom({ currentScript: false, scriptInDom: true });
    run(await loaderSource(), dom);

    const frame = dom.mounted.find((n) => n.tag === "iframe");
    const button = dom.mounted.find((n) => n.tag === "button");
    expect(frame).toBeDefined();
    expect(button).toBeDefined();
    // Origin kommt aus der Script-URL — nicht aus der Gastgeber-Seite.
    expect(frame?.src).toBe("https://demo.hallofhelp.com/widget");
    // Startzustand: geschlossen und für Screenreader unsichtbar.
    expect(frame?.style.cssText).toContain("display:none");
    expect(frame?.attrs["aria-hidden"]).toBe("true");
  });

  it("funktioniert weiterhin mit currentScript (klassisches Snippet)", async () => {
    const dom = makeDom({ currentScript: true, scriptInDom: false });
    run(await loaderSource(), dom);
    expect(dom.mounted.map((n) => n.tag)).toEqual(["iframe", "button"]);
  });

  it("bricht ohne auffindbares Script-Tag sauber ab (kein Wurf, kein Launcher)", async () => {
    const dom = makeDom({ currentScript: false, scriptInDom: false });
    expect(() => run("", dom)).not.toThrow();
    run(await loaderSource(), dom);
    expect(dom.mounted).toHaveLength(0);
  });

  it("montiert bei doppelter Einbindung nur einmal", async () => {
    const dom = makeDom();
    const src = await loaderSource();
    run(src, dom);
    run(src, dom); // zweites Snippet auf derselben Seite
    expect(dom.mounted).toHaveLength(2); // iframe + button, nicht 4
  });
});
