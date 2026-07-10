"use client";

import { useEffect, useState } from "react";
import { IconButton } from "@/components/ui/icon-button";
import { SunIcon, MoonIcon } from "@/components/ui/icons";

const KEY = "hh-theme";
type Theme = "light" | "dark";

function apply(theme: Theme) {
  document.documentElement.setAttribute("data-theme", theme);
  try {
    localStorage.setItem(KEY, theme);
  } catch {
    /* localStorage kann blockiert sein — dann nur für diese Session */
  }
}

function initialTheme(): Theme {
  const attr = document.documentElement.getAttribute("data-theme");
  if (attr === "dark" || attr === "light") return attr;
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

export interface ThemeToggleProps {
  /** Barrierefreies Label (i18n-fähig, vom Aufrufer). */
  label: string;
}

/** Schaltet zwischen Light und Dark (persistiert), respektiert No-Flash-Script. */
export function ThemeToggle({ label }: ThemeToggleProps) {
  const [theme, setTheme] = useState<Theme>("light");
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setTheme(initialTheme());
    setReady(true);
  }, []);

  function toggle() {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    apply(next);
  }

  return (
    <IconButton aria-label={label} aria-pressed={ready ? theme === "dark" : undefined} onClick={toggle}>
      {theme === "dark" ? <MoonIcon /> : <SunIcon />}
    </IconButton>
  );
}
