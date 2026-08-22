// Small sun/moon toggle. Reads current theme from <html data-theme>, flips it
// on click, persists to localStorage. The init script in index.html already
// applied the correct theme before hydration so there's no flash on first paint.
import { useEffect, useState } from "react";

export default function ThemeToggle() {
  const [theme, setTheme] = useState<"dark" | "light">(() => {
    if (typeof document === "undefined") return "light";
    return (document.documentElement.dataset.theme as any) || "light";
  });

  useEffect(() => {
    // Sync in case another tab / init script updated the attr after mount.
    const cur = (document.documentElement.dataset.theme as any) || "light";
    if (cur !== theme) setTheme(cur);
  }, []);

  function toggle() {
    const next = theme === "dark" ? "light" : "dark";
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem("cg-play-theme", next); } catch { /* ignore */ }
    setTheme(next);
  }

  return (
    <button onClick={toggle}
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
            aria-label="Toggle theme"
            className="rounded-full w-8 h-8 border hover:bg-[color:var(--hover)] transition text-sm"
            style={{ borderColor: "var(--border-strong)" }}>
      {theme === "dark" ? "☀" : "🌙"}
    </button>
  );
}
