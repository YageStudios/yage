import { relative, resolve, sep } from "node:path";

/** Keep all game-source HMR policy in the engine-owned Vite integration. */
export function yageHotReload() {
  let root;
  let serve = false;
  const systemFiles = new Set();
  const gameFile = (id) => {
    if (!serve || id.includes("?")) return false;
    const path = relative(root, id);
    return !path.startsWith(`..${sep}`) && !path.includes(`node_modules${sep}`);
  };
  return [
    {
      name: "yage:hot-systems",
      enforce: "pre",
      configResolved(config) {
        root = resolve(config.root);
        serve = config.command === "serve";
      },
      async handleHotUpdate(context) {
        if (!gameFile(context.file) || !/\.[cm]?[jt]s$/.test(context.file))
          return;
        const source = await context.read();
        const imported = source.match(
          /import\s*\{([^}]+)\}\s*from\s*(["'])minecs\2/
        );
        const system = imported?.[1].match(
          /\bSystem(?:\s+as\s+(\w+))?(?=\s*[,}]|\s*$)/
        );
        if (
          systemFiles.has(context.file) &&
          (!system ||
            !new RegExp(`@${system[1] ?? "System"}\\s*\\(`).test(source))
        ) {
          context.server.ws.send({ type: "full-reload", path: "*" });
          return [];
        }
        const binding = imported?.[1].match(
          /\bComponent(?:\s+as\s+(\w+))?(?=\s*[,}]|\s*$)/
        );
        if (
          binding &&
          new RegExp(`@${binding[1] ?? "Component"}\\s*\\(`).test(source)
        ) {
          // MineCS freezes storage schemas when the first world is created.
          context.server.ws.send({ type: "full-reload", path: "*" });
          return [];
        }
      },
      transform(source, id) {
        if (!gameFile(id) || !/\.[cm]?[jt]s$/.test(id)) return null;
        const imported = /import\s*\{([^}]+)\}\s*from\s*(["'])minecs\2/;
        const match = source.match(imported);
        if (!match) return null;
        const binding = match[1].match(
          /\bSystem(?:\s+as\s+(\w+))?(?=\s*[,}]|\s*$)/
        );
        if (!binding) return null;
        const local = binding[1] ?? "System";
        if (!new RegExp(`@${local}\\s*\\(`).test(source)) return null;
        systemFiles.add(id);
        const imports = match[1]
          .split(",")
          .filter((part) => part.trim() !== binding[0].trim())
          .join(",");
        const code = source.replace(
          match[0],
          `import {${imports}} from "minecs"`
        );
        const file = JSON.stringify(id);
        return {
          code: `import { hotSystem as __yageHotSystem, beginHotSystems as __yageBegin, finishHotSystems as __yageFinish } from "yage/dev/hotReload";\n__yageBegin(${file});\nconst ${local} = (...args) => __yageHotSystem(${file}, ...args);\n${code}\nif (import.meta.hot) {\n  if (!__yageFinish(${file}, !!import.meta.hot.data.yageLoaded)) import.meta.hot.invalidate("System structure changed");\n  import.meta.hot.data.yageLoaded = true;\n  import.meta.hot.accept();\n}`,
          map: null,
        };
      },
    },
    {
      name: "yage:hot-entities",
      enforce: "post",
      configResolved(config) {
        root = resolve(config.root);
        serve = config.command === "serve";
      },
      transform(source, id) {
        const [file, query = ""] = id.split("?", 2);
        if (
          !gameFile(file) ||
          /(?:^|&)(raw|url)(?:=|&|$)/.test(query) ||
          !/[\\/]entities[\\/].*\.(json|json5|jsonc)$/.test(file) ||
          !/^export default\s+/m.test(source)
        )
          return null;
        return {
          code: `${source.replace(
            /^export default\s+/m,
            "const __yageEntity = "
          )}\nexport default __yageEntity;\nimport { stageEntityDefinition as __yageStageEntity } from "yage/dev/hotReload";\nif (import.meta.hot) {\n  if (!__yageStageEntity(${JSON.stringify(
            file
          )}, __yageEntity, reason => import.meta.hot.invalidate(reason))) import.meta.hot.invalidate("Entity structure changed");\n  import.meta.hot.accept();\n}`,
          map: null,
        };
      },
    },
  ];
}
