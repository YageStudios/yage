import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import json5Plugin from "../vite-plugin-json5";

const examplesRoot = fileURLToPath(new URL(".", import.meta.url));

export default defineConfig({
  appType: "spa",
  root: examplesRoot,
  base: "/",
  build: {
    outDir: path.resolve(examplesRoot, "../testdist"),
  },
  server: {
    port: 5173,
    allowedHosts: [".sprkt.xyz"],
  },
  resolve: {
    alias: {
      yage: path.resolve(examplesRoot, "../engine/"),
    },
    extensions: [".ts", ".tsx", ".js", ".mjs"],
  },
  plugins: [json5Plugin()],
});
