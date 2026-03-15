import { resolve } from "path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/e2e/**/*.e2e.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    pool: "forks",
    singleFork: true,
  },
  resolve: {
    alias: {
      yage: resolve(__dirname, "./engine"),
    },
    extensions: [".ts", ".tsx", ".js"],
  },
});
