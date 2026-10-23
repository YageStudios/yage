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
    // minecs 0.2.0's build imports "lodash/cloneDeep" without an extension, which Node's ESM
    // loader rejects; letting Vite transform it resolves the import. Fixed upstream in minECS;
    // remove once a fixed minecs release is installed.
    server: { deps: { inline: ["minecs"] } },
    // Node suites have dedicated runners; browser e2e suites use their own config.
    exclude: ["test/tooling/**", "test/ui-final/**", "test/e2e/**", "node_modules/**", "dist/**"],
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
