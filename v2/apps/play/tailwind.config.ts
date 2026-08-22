import type { Config } from "tailwindcss";
export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        ink: {
          900: "#0a0f1c",
          800: "#0f172a",
          700: "#1e293b",
        },
      },
    },
  },
} satisfies Config;
