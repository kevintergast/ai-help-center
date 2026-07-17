import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Ops-Dashboard (ops/) teilt pure Produkt-Module über diesen Alias.
      "@product": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "ops/src/**/*.test.ts", "widget-demo/src/**/*.test.ts"],
  },
});
