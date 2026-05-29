import type { Config } from "tailwindcss";

// Colourful, neat design system for ChessGuru v2.
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
        // dark surfaces with good contrast (fixes old grey-on-black)
        ink: {
          950: "#0b0d12", 900: "#11141b", 800: "#1a1f29", 700: "#252b38",
          600: "#323a4d", 500: "#5b6678", 400: "#8b95a7", 300: "#c2c9d6",
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
