import { fileURLToPath } from "node:url";
import { readFileSync } from "node:fs";
import { defineConfig } from "vite";
import { libraryEntries, externalPredicate } from "./scripts/package-layout.mjs";

const root = fileURLToPath(new URL(".", import.meta.url));
const manifest = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
    alias: { yage: `${root}/engine` },
    // e2e suites run under their own config (vitest.e2e.config.ts) with
    // per-test timeouts and a single-fork pool.
    exclude: ["test/tooling/**", "test/e2e/**", "node_modules/**", "dist/**"],
  },
  resolve: {
    conditions: ["yage-source", "module", "browser", "development|production"],
    preserveSymlinks: false,
    dedupe: ["minecs", "pixi.js"],
  },
  build: {
    minify: false,
    sourcemap: true,
    lib: {
      entry: libraryEntries(root),
      formats: ["es"],
      fileName: (_format, name) => `${name}.js`,
      cssFileName: "style",
    },
    rollupOptions: {
      external: externalPredicate(manifest),
      treeshake: { moduleSideEffects: true },
    },
  },
});
