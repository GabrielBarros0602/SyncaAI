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
        // 127.0.0.1 rather than localhost, deliberately. Since Node 17 the resolver no
        // longer reorders DNS results, so on Windows `localhost` can answer ::1 first
        // while uvicorn listens only on 127.0.0.1. The symptom is ECONNREFUSED, which
        // reads like the API being down rather than like a name resolving to the wrong
        // address.
        target: "http://127.0.0.1:8000",
        changeOrigin: false,
      },
    },
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.{ts,tsx}"],
    setupFiles: ["tests/setup.ts"],
    // The timeout is there to catch a hang, not to time anything. The first test of a file
    // pays its worker's cold start (jsdom, React, the screen's module graph), which already
    // took 4 to 6 s under the full parallel run on the development machine against the
    // default of 5 s, so a test would fail or pass by how busy the machine happened to be.
    testTimeout: 15_000,
    // The contrast test reads tokens.css as text. Vitest empties every stylesheet it is not
    // told to process, `?raw` imports included, and the test would then find no tokens.
    css: { include: [/styles\/tokens\.css/] },
  },
});
