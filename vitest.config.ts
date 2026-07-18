import { defineConfig } from "vitest/config";

// Standalone config: the main vite.config.ts loads the Cloudflare plugin,
// which is incompatible with the vitest runner. Pure-logic tests only.
export default defineConfig({
  test: {
    include: ["src/**/*.test.ts", "shared/**/*.test.ts"],
    environment: "node",
  },
});
