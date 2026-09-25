import { defineConfig } from "vite";
import path from "path";
import { fileURLToPath } from "url";
import { yage } from "../tooling/vite.mjs";

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
  plugins: [yage()],
});
