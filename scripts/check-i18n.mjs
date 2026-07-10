// i18n-Coverage-Check: findet nutzersichtbare Literale in .tsx, die nicht über t() laufen.
// Geprüft werden JSX-Textknoten und übersetzbare Attribute (alt/title/placeholder/aria-label/label).
// Ausnahmen: src/i18n/allowed-phrases.json. Exit-Code 1 bei Fund (CI-Gate).
import fs from "node:fs";
import path from "node:path";
import url from "node:url";
import ts from "typescript";

const ROOT = path.resolve(url.fileURLToPath(new URL("..", import.meta.url)));
const SRC = path.join(ROOT, "src");
const ALLOW_FILE = path.join(SRC, "i18n", "allowed-phrases.json");
const TRANSLATABLE_ATTRS = new Set(["alt", "title", "placeholder", "aria-label", "label"]);
const hasLetter = (s) => /[A-Za-zÀ-ÖØ-öø-ÿ]/.test(s);

function loadAllowed() {
  try {
    const j = JSON.parse(fs.readFileSync(ALLOW_FILE, "utf8"));
    return new Set((j.phrases ?? []).map((s) => String(s).trim()));
  } catch {
    return new Set();
  }
}

function tsxFiles(dir) {
  const out = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(p));
    else if (e.name.endsWith(".tsx") && !e.name.endsWith(".test.tsx")) out.push(p);
  }
  return out;
}

export function scan() {
  const allowed = loadAllowed();
  const violations = [];
  for (const file of tsxFiles(SRC)) {
    const text = fs.readFileSync(file, "utf8");
    const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const push = (node, value) =>
      violations.push({
        file,
        line: sf.getLineAndCharacterOfPosition(node.getStart(sf)).line + 1,
        text: value,
      });
    const visit = (node) => {
      if (ts.isJsxText(node)) {
        const t = node.text.trim();
        if (t && hasLetter(t) && !allowed.has(t)) push(node, t);
      } else if (ts.isJsxAttribute(node) && node.initializer && ts.isStringLiteral(node.initializer)) {
        const name = node.name.getText(sf);
        const val = node.initializer.text.trim();
        if (TRANSLATABLE_ATTRS.has(name) && val && hasLetter(val) && !allowed.has(val)) {
          push(node, `${name}="${val}"`);
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sf);
  }
  return violations;
}

const isMain =
  process.argv[1] && path.resolve(process.argv[1]) === url.fileURLToPath(import.meta.url);
if (isMain) {
  const v = scan();
  if (v.length === 0) {
    console.log("✓ i18n-Check: keine unübersetzten Literale gefunden.");
    process.exit(0);
  }
  console.error(`✗ i18n-Check: ${v.length} unübersetzte(s) Literal(e):\n`);
  for (const x of v) {
    console.error(`  ${path.relative(ROOT, x.file)}:${x.line}  →  ${JSON.stringify(x.text)}`);
  }
  console.error(
    `\nBehebung: mit t("key") übersetzen ODER (falls bewusst literal) zu src/i18n/allowed-phrases.json hinzufügen.`,
  );
  process.exit(1);
}
