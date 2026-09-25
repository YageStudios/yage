/** Node-only tooling. No browser engine module is loaded by this entrypoint. */
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const engineRoot = realpathSync(fileURLToPath(new URL("../", import.meta.url)));
const engineManifest = JSON.parse(readFileSync(join(engineRoot, "package.json"), "utf8"));
const clientConditions = ["module", "browser", "development|production"];
// YAGE itself stays unoptimized so Vite can transform its globs. Its browser
// dependencies still need CJS conversion / shared optimized chunks.
const browserDependencies = [
  "@dimforge/rapier2d-deterministic-compat", "@json-editor/json-editor", "@pixi/sound",
  "ajv", "deep-object-diff", "js-base64", "l1-path-finder", "lodash", "nanoid",
  "ndarray", "peerjs", "pixi-spine", "pixi-viewport", "poly-decomp", "seedrandom",
  "socket.io-client", "toastify-js", "toposort", "url",
];
const unique = (items) => [...new Set(items)];
const normalize = (path) => path.replaceAll("\\", "/");

function inside(parent, file) {
  const path = relative(parent, file);
  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

// Read metadata without importing the package or requiring package.json to be exported.
function installedPackage(name, from) {
  let directory = resolve(from);
  for (;;) {
    const path = join(directory, "node_modules", name, "package.json");
    if (existsSync(path)) {
      return { root: dirname(realpathSync(path)), ...JSON.parse(readFileSync(path, "utf8")) };
    }
    const parent = dirname(directory);
    if (parent === directory) break;
    directory = parent;
  }
  throw new Error(`[yage] Missing ${name} in ${from}. Run npm install in the game before npm link yage.`);
}

function sharedDependencies(root) {
  const names = ["minecs", "pixi.js"];
  const installed = new Map();
  for (const name of names) {
    const pkg = installedPackage(name, root);
    const expected = engineManifest.peerDependencies[name];
    // These runtime peers intentionally use exact, validated version pins.
    if (pkg.version !== expected) {
      throw new Error(`[yage] ${name} ${pkg.version} is installed in the game, but this engine requires ${expected}. ` +
        `Install ${name}@${expected} in the game; deduplication cannot repair a version mismatch.`);
    }
    installed.set(name, pkg);
  }
  // @pixi/sound, pixi-spine and Pixi itself must also share Pixi's submodules.
  const visited = new Set();
  const visit = (pkg) => {
    for (const name of Object.keys(pkg.dependencies ?? {})) {
      if (!name.startsWith("@pixi/") || visited.has(name)) continue;
      visited.add(name);
      names.push(name);
      const child = installedPackage(name, pkg.root);
      // Vite dedupe resolves from the game root, so reject an inaccessible nested-only copy.
      const fromGame = installedPackage(name, root);
      if (child.version !== fromGame.version) {
        throw new Error(`[yage] Inconsistent ${name} versions. Reinstall/dedupe the game's Pixi dependencies.`);
      }
      visit(child);
    }
  };
  visit(installed.get("pixi.js"));
  return names;
}

/** JSON5/JSONC modules; ?raw and ?url stay under Vite's normal asset handling. */
export function yageJson5(options = {}) {
  return {
    name: "yage:json5",
    async transform(source, id) {
      const [filename, query = ""] = id.split("?", 2);
      if (!/\.(json5|jsonc)$/.test(filename) || /(?:^|&)(raw|url)(?:=|&|$)/.test(query)) return null;
      const [{ default: JSON5 }, { dataToEsm }] = await Promise.all([
        import("json5"), import("@rollup/pluginutils"),
      ]);
      try {
        const parsed = JSON5.parse(source.replace(/^\uFEFF/, ""));
        return {
          code: dataToEsm(parsed, { preferConst: true, namedExports: options.namedExports ?? true }),
          map: { mappings: "" },
        };
      } catch (error) {
        this.error(`Invalid JSON5 in ${filename}: ${error.message}`);
      }
    },
  };
}

/** Source-first by default; use source:false to exercise built/packed exports. */
export function yage({ source = true, reload = true, json5 = true } = {}) {
  const watchRoots = [join(engineRoot, "engine"), join(engineRoot, "assets")];
  let cleanup = () => {};
  const plugin = {
    name: "yage:linked-engine",
    enforce: "pre",
    config(config) {
      const root = resolve(config.root ?? process.cwd());
      if (config.resolve?.preserveSymlinks === true) {
        throw new Error("[yage] Remove resolve.preserveSymlinks:true. Engine modules must use their real paths.");
      }
      if (source && config.optimizeDeps?.include?.some((id) => id === "yage" || id.startsWith("yage/"))) {
        throw new Error("[yage] Remove yage from optimizeDeps.include; linked engine source must pass through Vite.");
      }
      if (source && !existsSync(join(engineRoot, "engine", "index.ts"))) {
        throw new Error("[yage] Engine source is missing. Link a checkout, or use yage({ source: false }).");
      }
      if (!source && config.resolve?.conditions?.includes("yage-source")) {
        throw new Error("[yage] source:false cannot be combined with the yage-source condition.");
      }
      const nested = browserDependencies.map((name) => inside(engineRoot, root) ? name : `yage > ${name}`);
      return {
        optimizeDeps: {
          include: unique([...(config.optimizeDeps?.include ?? []), "minecs", "pixi.js", ...nested]),
          ...(source ? { exclude: unique([...(config.optimizeDeps?.exclude ?? []), "yage"]) } : {}),
        },
        resolve: {
          conditions: unique([
            ...(source ? ["yage-source"] : []),
            ...(config.resolve?.conditions ?? clientConditions),
          ]),
          preserveSymlinks: false,
          dedupe: unique([...(config.resolve?.dedupe ?? []), ...sharedDependencies(root)]),
        },
        ...(source ? {
          server: {
            fs: { allow: unique([...(config.server?.fs?.allow ?? [root]), normalize(engineRoot)]) },
          },
        } : {}),
      };
    },
    configureServer(server) {
      cleanup();
      if (!source || !reload) return;
      let timer;
      let closed = false;
      const changed = (event, file) => {
        if (!["add", "change", "unlink", "addDir", "unlinkDir"].includes(event)) return;
        if (!watchRoots.some((root) => inside(root, resolve(file)))) return;
        clearTimeout(timer);
        timer = setTimeout(() => {
          if (closed) return;
          // Also invalidate import.meta.glob expansions after additions/deletions.
          // Only invalidating the changed module misses files not in the graph yet.
          server.moduleGraph.invalidateAll();
          server.ws.send({ type: "full-reload", path: "*" });
        }, 75);
      };
      server.watcher.add(watchRoots);
      server.watcher.on("all", changed);
      cleanup = () => {
        closed = true;
        clearTimeout(timer);
        server.watcher.off("all", changed);
        server.httpServer?.off("close", cleanup);
      };
      server.httpServer?.once("close", cleanup);
    },
    handleHotUpdate(context) {
      if (source && reload && watchRoots.some((root) => inside(root, context.file))) {
        // The watcher sends one debounced full reload instead of swapping registered classes.
        return [];
      }
    },
    closeBundle() { cleanup(); },
  };
  return [plugin, ...(json5 ? [yageJson5(typeof json5 === "object" ? json5 : {})] : [])];
}

export default yage;
