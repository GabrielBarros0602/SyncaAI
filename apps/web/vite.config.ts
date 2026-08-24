import react from "@vitejs/plugin-react";
// defineConfig from vitest, not from vite: the `test` block is Vitest's and the vite
// export does not know about it.
import { defineConfig } from "vitest/config";

/**
 * One origin, on purpose (ADR-0021).
 *
 * The browser only ever talks to this dev server. Requests to `/api` are forwarded to the
 * API, so nothing the page issues is cross-origin — which is what keeps `SameSite=Strict`
 * on the refresh cookie valid, and why the API needs no CORS middleware at all.
 *
 * The practical failure mode to recognise: if this proxy is missing or misspelled, calls
 * fail as a 404 on `/api/...`, which reads like a missing endpoint rather than a missing
 * rewrite.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": {
        target: "http://localhost:8000",
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
  },
});
