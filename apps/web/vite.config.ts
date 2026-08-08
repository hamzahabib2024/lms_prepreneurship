import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
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
