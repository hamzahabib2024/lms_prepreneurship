import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { fileURLToPath } from "node:url";

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      /*
       * THE SOURCE, NOT THE BUILT PACKAGE.
       *
       * packages/shared builds to CommonJS for the API, which re-exports
       * through __exportStar — and Rollup cannot see named exports through
       * that, so the first VALUE imported from @lms/shared in this app failed
       * the production build with "is not exported by dist/index.js". Type
       * imports had always worked because they are erased before Rollup runs,
       * which is why nothing noticed until now.
       *
       * Pointing at the source fixes that and removes a second trap: the web
       * build no longer depends on whether somebody remembered to rebuild the
       * shared package, which is a stale-dist bug waiting to be blamed on
       * something else. Vite compiles the TypeScript itself.
       */
      "@lms/shared": fileURLToPath(new URL("../../packages/shared/src", import.meta.url)),
    },
  },
  server: {
    port: 5173,
    // Proxying in development means the browser sees a same-origin API, so
    // CORS and cookie behaviour match production rather than being a
    // development-only special case.
    proxy: {
      "/api": { target: "http://localhost:3000", changeOrigin: true },
    },
  },
  build: { outDir: "dist", sourcemap: true },
});
