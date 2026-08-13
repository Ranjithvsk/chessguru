// Day/light-mode plumbing. The initial theme is resolved BEFORE React mounts
// (see the inline <script> in index.html) so the page never flashes. This
// hook is the runtime source-of-truth after that first paint.
//
// Three settings — "light", "dark", "system". "system" follows the OS's
// prefers-color-scheme and re-applies live when the OS switches (macOS
// auto-scheduling / Windows auto-brightness).
import { useCallback, useEffect, useState } from "react";

export type ThemeChoice = "light" | "dark" | "system";
export type ResolvedTheme = "light" | "dark";
const KEY = "cg.theme";

function resolveSystem(): ResolvedTheme {
  if (typeof window === "undefined" || !window.matchMedia) return "dark";
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function readChoice(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    if (v === "light" || v === "dark" || v === "system") return v;
  } catch { /* */ }
  return "system";
}

function apply(resolved: ResolvedTheme): void {
  const root = document.documentElement;
  root.classList.toggle("light", resolved === "light");
  root.classList.toggle("dark", resolved !== "light");
}

export function useTheme() {
  const [choice, setChoiceState] = useState<ThemeChoice>(() => readChoice());
  const [resolved, setResolved] = useState<ResolvedTheme>(() =>
    choice === "system" ? resolveSystem() : (choice as ResolvedTheme)
  );

  const setChoice = useCallback((next: ThemeChoice) => {
    try { localStorage.setItem(KEY, next); } catch { /* */ }
    setChoiceState(next);
    const eff: ResolvedTheme = next === "system" ? resolveSystem() : next;
    setResolved(eff);
    apply(eff);
  }, []);

  // Follow OS live when the user is on "system".
  useEffect(() => {
    if (choice !== "system") return;
    if (typeof window === "undefined" || !window.matchMedia) return;
    const mq = window.matchMedia("(prefers-color-scheme: light)");
    const onChange = () => {
      const eff = mq.matches ? "light" : "dark";
      setResolved(eff);
      apply(eff);
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, [choice]);

  const toggle = useCallback(() => {
    // Explicit toggle collapses "system" into whichever is opposite the
    // currently-effective theme, so the button always visibly does something.
    setChoice(resolved === "light" ? "dark" : "light");
  }, [resolved, setChoice]);

  return { choice, resolved, setChoice, toggle };
}
