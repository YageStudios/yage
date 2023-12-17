// vite.config.js
import { resolve } from "path";
import dts from "file:///C:/workspace/yage/node_modules/vite-plugin-dts/dist/index.mjs";
import { defineConfig } from "file:///C:/workspace/yage/node_modules/vite/dist/node/index.js";
import glob from "file:///C:/workspace/yage/node_modules/fast-glob/out/index.js";
var __vite_injected_original_dirname = "C:\\workspace\\yage";
var files = glob.sync([
  "./engine/{components,connection,console,constants,decorators,entity,game,inputs,loader,persist,schemas,types,ui,utils,vendor}/**/*.{ts,js}"
]).map((file) => {
  const key = file.match(/(?<=\.\/engine\/).*(?=\.ts|\.js)/);
  return [key[0], file];
});
var entries = Object.fromEntries(files);
var vite_config_default = defineConfig({
  build: {
    minify: false,
    sourcemap: true,
    lib: {
      name: "YAGE",
      // the proper extensions will be added
      entry: entries,
      formats: ["es"]
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
        "bitecs",
        "l1-path-finder",
        "lodash",
        "nanoid",
        "ndarray",
        "peerjs",
        "seedrandom",
        "socket.io-client",
        "toposort",
        "url"
      ]
    }
    //   // make sure to externalize deps that shouldn't be bundled
    //   // into your library
    //   external: ["pixi.js", "pixi-spine", "pixi-viewport"],
    //   output: {
    //     // Provide global variables to use in the UMD build
    //     // for externalized deps
    //     globals: {
    //       "pixi.js": "PIXI",
    //       "pixi-spine": "PIXI.spine",
    //       "pixi-viewport": "PIXI.viewport",
    //     },
    //   },
    // },
  },
  plugins: [dts()],
  resolve: {
    alias: {
      "@": resolve(__vite_injected_original_dirname, "./engine")
    },
    extensions: [".ts", ".tsx", ".js"]
  }
});
export {
  vite_config_default as default
};
//# sourceMappingURL=data:application/json;base64,ewogICJ2ZXJzaW9uIjogMywKICAic291cmNlcyI6IFsidml0ZS5jb25maWcuanMiXSwKICAic291cmNlc0NvbnRlbnQiOiBbImNvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9kaXJuYW1lID0gXCJDOlxcXFx3b3Jrc3BhY2VcXFxceWFnZVwiO2NvbnN0IF9fdml0ZV9pbmplY3RlZF9vcmlnaW5hbF9maWxlbmFtZSA9IFwiQzpcXFxcd29ya3NwYWNlXFxcXHlhZ2VcXFxcdml0ZS5jb25maWcuanNcIjtjb25zdCBfX3ZpdGVfaW5qZWN0ZWRfb3JpZ2luYWxfaW1wb3J0X21ldGFfdXJsID0gXCJmaWxlOi8vL0M6L3dvcmtzcGFjZS95YWdlL3ZpdGUuY29uZmlnLmpzXCI7Ly8gY29uc3QgcGF0aCA9IHJlcXVpcmUoXCJwYXRoXCIpO1xuaW1wb3J0IHsgcmVzb2x2ZSB9IGZyb20gXCJwYXRoXCI7XG5pbXBvcnQgZHRzIGZyb20gXCJ2aXRlLXBsdWdpbi1kdHNcIjtcblxuLy8gdml0ZS5jb25maWcuanNcbmltcG9ydCB7IGRlZmluZUNvbmZpZyB9IGZyb20gXCJ2aXRlXCI7XG5pbXBvcnQgZ2xvYiBmcm9tIFwiZmFzdC1nbG9iXCI7XG5jb25zdCBmaWxlcyA9IGdsb2JcbiAgLnN5bmMoW1xuICAgIFwiLi9lbmdpbmUve2NvbXBvbmVudHMsY29ubmVjdGlvbixjb25zb2xlLGNvbnN0YW50cyxkZWNvcmF0b3JzLGVudGl0eSxnYW1lLGlucHV0cyxsb2FkZXIscGVyc2lzdCxzY2hlbWFzLHR5cGVzLHVpLHV0aWxzLHZlbmRvcn0vKiovKi57dHMsanN9XCIsXG4gIF0pXG4gIC5tYXAoKGZpbGUpID0+IHtcbiAgICBjb25zdCBrZXkgPSBmaWxlLm1hdGNoKC8oPzw9XFwuXFwvZW5naW5lXFwvKS4qKD89XFwudHN8XFwuanMpLyk7XG4gICAgcmV0dXJuIFtrZXlbMF0sIGZpbGVdO1xuICB9KTtcbmNvbnN0IGVudHJpZXMgPSBPYmplY3QuZnJvbUVudHJpZXMoZmlsZXMpO1xuLy8gY29uc29sZS5sb2coZW50cmllcyk7XG5cbmV4cG9ydCBkZWZhdWx0IGRlZmluZUNvbmZpZyh7XG4gIGJ1aWxkOiB7XG4gICAgbWluaWZ5OiBmYWxzZSxcblxuICAgIHNvdXJjZW1hcDogdHJ1ZSxcbiAgICBsaWI6IHtcbiAgICAgIG5hbWU6IFwiWUFHRVwiLFxuICAgICAgLy8gdGhlIHByb3BlciBleHRlbnNpb25zIHdpbGwgYmUgYWRkZWRcbiAgICAgIGVudHJ5OiBlbnRyaWVzLFxuICAgICAgZm9ybWF0czogW1wiZXNcIl0sXG5cbiAgICAgIC8vIGVudHJ5OiB7XG4gICAgICAvLyAgIFwiY29uc3RhbnRzL2VudW1zXCI6IFwiLi9lbmdpbmUvY29uc3RhbnRzL2VudW1zLnRzXCIsXG4gICAgICAvLyB9LFxuICAgIH0sXG5cbiAgICByb2xsdXBPcHRpb25zOiB7XG4gICAgICBleHRlcm5hbDogW1xuICAgICAgICBcInBpeGkuanNcIixcbiAgICAgICAgXCJwaXhpLXNwaW5lXCIsXG4gICAgICAgIFwicGl4aS12aWV3cG9ydFwiLFxuICAgICAgICBcIkBkaW1mb3JnZS9yYXBpZXIyZC1jb21wYXRcIixcbiAgICAgICAgXCJhanZcIixcbiAgICAgICAgXCJiaXRlY3NcIixcbiAgICAgICAgXCJsMS1wYXRoLWZpbmRlclwiLFxuICAgICAgICBcImxvZGFzaFwiLFxuICAgICAgICBcIm5hbm9pZFwiLFxuICAgICAgICBcIm5kYXJyYXlcIixcbiAgICAgICAgXCJwZWVyanNcIixcbiAgICAgICAgXCJzZWVkcmFuZG9tXCIsXG4gICAgICAgIFwic29ja2V0LmlvLWNsaWVudFwiLFxuICAgICAgICBcInRvcG9zb3J0XCIsXG4gICAgICAgIFwidXJsXCIsXG4gICAgICBdLFxuICAgIH0sXG4gICAgLy8gICAvLyBtYWtlIHN1cmUgdG8gZXh0ZXJuYWxpemUgZGVwcyB0aGF0IHNob3VsZG4ndCBiZSBidW5kbGVkXG4gICAgLy8gICAvLyBpbnRvIHlvdXIgbGlicmFyeVxuICAgIC8vICAgZXh0ZXJuYWw6IFtcInBpeGkuanNcIiwgXCJwaXhpLXNwaW5lXCIsIFwicGl4aS12aWV3cG9ydFwiXSxcbiAgICAvLyAgIG91dHB1dDoge1xuICAgIC8vICAgICAvLyBQcm92aWRlIGdsb2JhbCB2YXJpYWJsZXMgdG8gdXNlIGluIHRoZSBVTUQgYnVpbGRcbiAgICAvLyAgICAgLy8gZm9yIGV4dGVybmFsaXplZCBkZXBzXG4gICAgLy8gICAgIGdsb2JhbHM6IHtcbiAgICAvLyAgICAgICBcInBpeGkuanNcIjogXCJQSVhJXCIsXG4gICAgLy8gICAgICAgXCJwaXhpLXNwaW5lXCI6IFwiUElYSS5zcGluZVwiLFxuICAgIC8vICAgICAgIFwicGl4aS12aWV3cG9ydFwiOiBcIlBJWEkudmlld3BvcnRcIixcbiAgICAvLyAgICAgfSxcbiAgICAvLyAgIH0sXG4gICAgLy8gfSxcbiAgfSxcbiAgcGx1Z2luczogW2R0cygpXSxcbiAgcmVzb2x2ZToge1xuICAgIGFsaWFzOiB7XG4gICAgICBcIkBcIjogcmVzb2x2ZShfX2Rpcm5hbWUsIFwiLi9lbmdpbmVcIiksXG4gICAgfSxcbiAgICBleHRlbnNpb25zOiBbXCIudHNcIiwgXCIudHN4XCIsIFwiLmpzXCJdLFxuICB9LFxufSk7XG4iXSwKICAibWFwcGluZ3MiOiAiO0FBQ0EsU0FBUyxlQUFlO0FBQ3hCLE9BQU8sU0FBUztBQUdoQixTQUFTLG9CQUFvQjtBQUM3QixPQUFPLFVBQVU7QUFOakIsSUFBTSxtQ0FBbUM7QUFPekMsSUFBTSxRQUFRLEtBQ1gsS0FBSztBQUFBLEVBQ0o7QUFDRixDQUFDLEVBQ0EsSUFBSSxDQUFDLFNBQVM7QUFDYixRQUFNLE1BQU0sS0FBSyxNQUFNLGtDQUFrQztBQUN6RCxTQUFPLENBQUMsSUFBSSxDQUFDLEdBQUcsSUFBSTtBQUN0QixDQUFDO0FBQ0gsSUFBTSxVQUFVLE9BQU8sWUFBWSxLQUFLO0FBR3hDLElBQU8sc0JBQVEsYUFBYTtBQUFBLEVBQzFCLE9BQU87QUFBQSxJQUNMLFFBQVE7QUFBQSxJQUVSLFdBQVc7QUFBQSxJQUNYLEtBQUs7QUFBQSxNQUNILE1BQU07QUFBQTtBQUFBLE1BRU4sT0FBTztBQUFBLE1BQ1AsU0FBUyxDQUFDLElBQUk7QUFBQTtBQUFBO0FBQUE7QUFBQSxJQUtoQjtBQUFBLElBRUEsZUFBZTtBQUFBLE1BQ2IsVUFBVTtBQUFBLFFBQ1I7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLFFBQ0E7QUFBQSxRQUNBO0FBQUEsUUFDQTtBQUFBLE1BQ0Y7QUFBQSxJQUNGO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQTtBQUFBO0FBQUE7QUFBQSxFQWNGO0FBQUEsRUFDQSxTQUFTLENBQUMsSUFBSSxDQUFDO0FBQUEsRUFDZixTQUFTO0FBQUEsSUFDUCxPQUFPO0FBQUEsTUFDTCxLQUFLLFFBQVEsa0NBQVcsVUFBVTtBQUFBLElBQ3BDO0FBQUEsSUFDQSxZQUFZLENBQUMsT0FBTyxRQUFRLEtBQUs7QUFBQSxFQUNuQztBQUNGLENBQUM7IiwKICAibmFtZXMiOiBbXQp9Cg==
