import type { Config } from "tailwindcss";

export default {
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      // White-Label + Design-Tokens: Farben kommen aus CSS-Variablen (globals.css),
      // die pro Tenant und pro Theme (Light/Dark) gesetzt werden.
      colors: {
        brand: {
          DEFAULT: "var(--brand-primary)",
          accent: "var(--brand-accent)",
          fg: "var(--brand-primary-fg)",
        },
        surface: {
          DEFAULT: "var(--surface)",
          raised: "var(--surface-2)",
        },
        ink: {
          DEFAULT: "var(--ink)",
          muted: "var(--muted)",
        },
        hairline: {
          DEFAULT: "var(--border)",
          strong: "var(--border-strong)",
        },
        tint: "var(--tint)",
        ok: { DEFAULT: "var(--sem-ok)", bg: "var(--sem-ok-bg)", bd: "var(--sem-ok-bd)" },
        warn: { DEFAULT: "var(--sem-warn)", bg: "var(--sem-warn-bg)", bd: "var(--sem-warn-bd)" },
        crit: { DEFAULT: "var(--sem-crit)", bg: "var(--sem-crit-bg)", bd: "var(--sem-crit-bd)" },
      },
      borderRadius: {
        micro: "4px",
        std: "6px",
        comfy: "8px",
        card: "12px",
        container: "16px",
      },
      boxShadow: {
        inset: "var(--shadow-inset)",
        focusglow: "var(--shadow-focus)",
      },
      fontFamily: {
        // HINWEIS: "Camera Plain Variable" (Produktschrift lt. DESIGN.md) ist noch
        // NICHT im Repo self-hosted — bis dahin greift der System-Fallback darunter.
        // Sobald die lizenzierte Font-Datei vorliegt: via `next/font/local` im
        // Root-Layout laden (automatisches Preload + size-adjusted Fallback → kein
        // FOUT/Layout-Shift) und dessen CSS-Variable hier an den Anfang setzen.
        sans: [
          '"Camera Plain Variable"',
          "ui-sans-serif",
          "system-ui",
          "-apple-system",
          '"Segoe UI"',
          "Roboto",
          '"Helvetica Neue"',
          "sans-serif",
        ],
      },
      maxWidth: {
        book: "1100px",
      },
    },
  },
  plugins: [],
} satisfies Config;
