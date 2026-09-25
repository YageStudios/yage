import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";
import { startE2eDevServer } from "./test/e2e/dev-server.mjs";

// The e2e suite owns its dev server: it boots one on a dedicated port (5273)
// unless YAGE_E2E_BASE_URL points somewhere else. Test files read the
// injected env var, so `npm run test:e2e` works without any manual setup.
const baseUrl = await startE2eDevServer();

export default defineConfig({
  test: {
    environment: "node",
    alias: { yage: fileURLToPath(new URL("./engine", import.meta.url)) },
    include: ["test/e2e/**/*.e2e.test.ts"],
    env: { YAGE_E2E_BASE_URL: baseUrl },
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
