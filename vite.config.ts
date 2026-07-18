import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

// Plain Vite build → dist/ (SPA). The server side runs as a Cloudflare Pages
// Function (functions/api/[[route]].ts). In local dev the SPA is served by
// Vite and /api is proxied to the Node-hosted worker (`npm run dev:api`).
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    proxy: {
      "/api": "http://127.0.0.1:8788",
    },
  },
});
