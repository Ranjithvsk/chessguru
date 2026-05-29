import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Phase 0: proxy /api and /auth to the EXISTING Express backend on :3000 so the
// new UI shows real puzzles immediately. Phase 1 repoints these to the NestJS API (:4000).
export default defineConfig({
  plugins: [react()],
  base: "/v2/",
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
      "/auth": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
});
