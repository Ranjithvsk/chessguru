import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Deploy target: /var/www/chessguru-play/ — nginx serves as static + proxies /v2api/*.
// Build outputs to dist/. rsync dist/ /var/www/chessguru-play/ on deploy.
export default defineConfig({
  plugins: [react()],
  server: { port: 5183 },
  build: { outDir: "dist", sourcemap: false, chunkSizeWarningLimit: 800 },
});
