import type { Config } from "tailwindcss";

// Colourful, neat design system for ChessGuru v2.
// The ink-* neutral palette resolves through CSS variables so we can flip the
// entire app between dark (default) and light modes by swapping var values
// on <html class="light">. See src/index.css for the light-mode overrides.
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  darkMode: "class",
  theme: {
    extend: {
      colors: {
        // vibrant brand palette
        brand: {
          50: "#eef2ff", 100: "#e0e7ff", 200: "#c7d2fe", 300: "#a5b4fc",
          400: "#818cf8", 500: "#6366f1", 600: "#4f46e5", 700: "#4338ca",
          800: "#3730a3", 900: "#312e81",
        },
        accent: {
          // emerald accent (success / "best move")
          400: "#34d399", 500: "#10b981", 600: "#059669",
        },
        gold: { 400: "#fbbf24", 500: "#f59e0b" },
        // Neutral surfaces are theme-swappable — see src/index.css.
        ink: {
          950: "rgb(var(--ink-950) / <alpha-value>)",
          900: "rgb(var(--ink-900) / <alpha-value>)",
          800: "rgb(var(--ink-800) / <alpha-value>)",
          700: "rgb(var(--ink-700) / <alpha-value>)",
          600: "rgb(var(--ink-600) / <alpha-value>)",
          500: "rgb(var(--ink-500) / <alpha-value>)",
          400: "rgb(var(--ink-400) / <alpha-value>)",
          300: "rgb(var(--ink-300) / <alpha-value>)",
          200: "rgb(var(--ink-200) / <alpha-value>)",
          100: "rgb(var(--ink-100) / <alpha-value>)",
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
        display: ['"DM Serif Display"', 'Georgia', 'serif'],
      },
      boxShadow: {
        glow: "0 0 0 1px rgba(99,102,241,.25), 0 10px 30px -10px rgba(99,102,241,.45)",
      },
      borderRadius: { xl2: "1rem" },
    },
  },
  plugins: [],
} satisfies Config;
