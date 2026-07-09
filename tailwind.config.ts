import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // White-Label: Marken-Farben kommen aus CSS-Variablen, die pro Tenant gesetzt werden.
      colors: {
        brand: {
          DEFAULT: "var(--brand-primary)",
          accent: "var(--brand-accent)",
          fg: "var(--brand-primary-fg)",
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
