import { defineConfig } from "vitest/config";
import { loadEnv } from "vite";
import react from "@vitejs/plugin-react";

// The frontend runs same-origin against the Phase 4/9 node:http API through the
// dev proxy, so the HttpOnly `ar_seat_session` cookie set by the backend flows
// naturally (same-origin). Point VITE_API_TARGET at a running backend server.
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), "");
  const apiTarget = env.VITE_API_TARGET || "http://localhost:8787";
  return {
    plugins: [react()],
    server: {
      proxy: {
        "/auth": { target: apiTarget, changeOrigin: false },
        "/exam-seating": { target: apiTarget, changeOrigin: false },
      },
    },
    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: ["./src/test/setup.ts"],
      css: false,
    },
  };
});