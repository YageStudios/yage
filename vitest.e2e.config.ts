import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    alias: { yage: fileURLToPath(new URL("./engine", import.meta.url)) },
    include: ["test/e2e/**/*.e2e.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    pool: "forks",
    singleFork: true,
  },
  resolve: {
    conditions: ["yage-source", "node", "development|production"],
    preserveSymlinks: false,
  },
});
