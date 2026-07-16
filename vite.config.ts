import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { cloudflare } from "@cloudflare/vite-plugin";

// DISABLE_CF_PLUGIN=1 (npm run dev:node) runs the SPA without workerd — the
// workerd binary cannot start on some Windows hosts. In that mode /api is
// proxied to the Node-hosted worker API (npm run dev:api).
export default defineConfig(() => {
  const noCf = process.env.DISABLE_CF_PLUGIN === "1";
  return {
    plugins: [react(), tailwindcss(), ...(noCf ? [] : [cloudflare()])],
    server: noCf
      ? { proxy: { "/api": "http://127.0.0.1:8788" } }
      : undefined,
  };
});
