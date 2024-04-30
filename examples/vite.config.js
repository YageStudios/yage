// vite.config.ts
import { defineConfig } from "vite";
import path from "path";
import json5Plugin from "../vite-plugin-json5";

export default defineConfig({
  root: "tests",
  base: "",
  build: {
    outDir: "../testdist",
  },
  server: {
    port: 3000,
  },
  resolve: {
    alias: {
      yage: path.resolve(__dirname, "../engine/"),
    },
    extensions: [".ts", ".tsx", ".js", ".mjs"],
  },
  plugins: [json5Plugin()],
});
