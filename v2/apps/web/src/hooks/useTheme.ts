// Day/light-mode plumbing. The initial theme is resolved BEFORE React mounts
// (see the inline <script> in index.html) so the page never flashes. This
// hook is the runtime source-of-truth after that first paint.
//
// Default is LIGHT — owner ask 2026-08-13. Only "dark" and "light" are stored;
// an unset key resolves to light. The navbar sun/moon toggle just flips
// between the two.
import { useCallback, useState } from "react";

export type ThemeChoice = "light" | "dark";
const KEY = "cg.theme";

function readChoice(): ThemeChoice {
  try {
    if (localStorage.getItem(KEY) === "dark") return "dark";
  } catch { /* */ }
  return "light";
}

function apply(resolved: ThemeChoice): void {
  const root = document.documentElement;
  root.classList.toggle("light", resolved === "light");
  root.classList.toggle("dark", resolved === "dark");
}

export function useTheme() {
  const [resolved, setResolved] = useState<ThemeChoice>(() => readChoice());

  const setChoice = useCallback((next: ThemeChoice) => {
    try { localStorage.setItem(KEY, next); } catch { /* */ }
    setResolved(next);
    apply(next);
  }, []);

  const toggle = useCallback(() => {
    setChoice(resolved === "light" ? "dark" : "light");
  }, [resolved, setChoice]);

  return { choice: resolved, resolved, setChoice, toggle };
}
