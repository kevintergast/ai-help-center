// ESLint 9 Flat-Config. Ersetzt `next lint` (deprecated) durch die ESLint-CLI —
// deterministisch in CI (kein interaktiver Prompt, keine Netz-/Telemetrie-Schritte).
// Übernimmt die bisherige Regelbasis `next/core-web-vitals` via FlatCompat.
import { dirname } from "path";
import { fileURLToPath } from "url";
import { FlatCompat } from "@eslint/eslintrc";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const compat = new FlatCompat({ baseDirectory: __dirname });

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".open-next/**",
      ".wrangler/**",
      "node_modules/**",
      "next-env.d.ts",
      "cloudflare-env.d.ts",
      // Build-/Tooling-Config im Root — von `next lint` nie gelintet, hier ebenso ausgenommen.
      "*.config.{js,cjs,mjs,ts}",
      // Ops-Dashboard (ops/): eigenes Paket mit hono/jsx — React-Regeln
      // (className, jsx-key-Semantik) passen dort nicht; Qualitätssicherung
      // läuft über `pnpm -C ops typecheck` (strict) + Vitest.
      "ops/**",
    ],
  },
  ...compat.extends("next/core-web-vitals"),
];

export default eslintConfig;
