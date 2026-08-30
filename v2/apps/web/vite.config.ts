import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// Phase 0: proxy /api and /auth to the EXISTING Express backend on :3000 so the
// new UI shows real puzzles immediately. Phase 1 repoints these to the NestJS API (:4000).
export default defineConfig({
  plugins: [react()],
  base: "/",
  server: {
    port: 5173,
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
      "/auth": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  build: {
    // Bump the size-warning threshold to something realistic for our app so
    // the "chunks larger than 500 kB" warning stops crying wolf on every
    // build. The real fix is route-based lazy loading (see world-class doc);
    // this just keeps the log readable in the meantime.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Vendor-chunk split (2026-08-30). These packages change ~monthly at
        // most; splitting them out means the vast majority of deploys leave
        // the vendor bundle hash untouched → browsers keep serving it from
        // cache and only re-download the small app chunk. First-visit cost
        // is unchanged; every subsequent visit-after-deploy is much lighter.
        //
        // Rule of thumb: node_modules → vendor unless it changes often OR is
        // only used by one lazy-loaded route. Chess engine deps (~150 KB
        // gzip combined) qualify because they load on almost every page.
        //
        // Fees pages already have their own lazy-load chunks via React.lazy
        // (main.tsx); recharts stays with FeesReports (not here) so
        // non-fees users never download it.
        manualChunks(id) {
          if (!id.includes("node_modules")) return undefined;
          // Framework — smallest slice, changes on React majors only.
          if (/\/(react|react-dom|scheduler)\//.test(id)) return "vendor-react";
          if (/\/(react-router|react-router-dom|history)\//.test(id)) return "vendor-router";
          if (/\/@tanstack\/react-query\//.test(id)) return "vendor-query";
          // Chess libraries — used on most pages that show a board.
          if (/\/(chess\.js|chessground|chessops)\//.test(id)) return "vendor-chess";
          // Heavy leaf deps that are lazy-loaded already: recharts (fees
          // reports only) + html-to-image (screenshot capture only). Keep
          // them out of the shared vendor bundle so lazy chunks stay lean.
          if (/\/(recharts|html-to-image|d3-|victory-vendor)\//.test(id)) return undefined;
          // Everything else in node_modules → shared vendor.
          return "vendor-misc";
        },
      },
    },
  },
});
