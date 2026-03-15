// const path = require("path");
import { resolve } from "path";
import dts from "vite-plugin-dts";

// vite.config.js
import { defineConfig } from "vite";
import glob from "fast-glob";
const files = glob
  .sync([
    "./engine/{achievements,systems,connection,console,constants,decorators,entity,game,inputs,loader,persist,schemas,testing,types,ui,utils,vendor}/**/*.{ts,js}",
  ])
  .map((file) => {
    const key = file.match(/(?<=\.\/engine\/).*(?=\.ts|\.js)/);
    return [key[0], file];
  });
const entries = Object.fromEntries(files);

export default defineConfig({
  test: {
    environment: "node",
    setupFiles: ["./test/setup.ts"],
  },
  build: {
    minify: false,

    sourcemap: true,
    lib: {
      name: "YAGE",
      // the proper extensions will be added
      entry: entries,
      formats: ["es"],

      // entry: {
      //   "constants/enums": "./engine/constants/enums.ts",
      // },
    },

    rollupOptions: {
      external: [
        "pixi.js",
        "pixi-spine",
        "pixi-viewport",
        "@dimforge/rapier2d-compat",
        "ajv",
        "minecs",
        "l1-path-finder",
        "lodash",
        "nanoid",
        "ndarray",
        "peerjs",
        "playwright-core",
        "seedrandom",
        "socket.io-client",
        "toposort",
        "url",
        "fs",
        "path",
      ],
    },
  },
  plugins: [
    dts({
      entryRoot: "./engine",
      outDir: "./dist",
    }),
  ],
  resolve: {
    alias: {
      yage: resolve(__dirname, "./engine"),
    },
    extensions: [".ts", ".tsx", ".js"],
  },
});
