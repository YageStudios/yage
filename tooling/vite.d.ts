import type { Plugin, PluginOption } from "vite";

export interface YageJson5Options { namedExports?: boolean }
export interface YageViteOptions {
  /** Select TypeScript source exports in dev AND production builds. Default true. */
  source?: boolean;
  /** Reload the page on engine source/asset edits, additions and deletions. Default true. */
  reload?: boolean;
  /** Replace game systems and entity definitions at the next frame. Development only. Default false. */
  hotReload?: boolean;
  /** Enable JSON5/JSONC imports, leaving ?raw and ?url untouched, in the page and in worker bundles (worker.plugins). Default true. */
  json5?: boolean | YageJson5Options;
}
export declare function yage(options?: YageViteOptions): Plugin[];
export declare function yageJson5(options?: YageJson5Options): Plugin;
/** Wraps a `worker.plugins` factory so worker bundles also get the JSON5 transform (once). yage() does this itself. */
export declare function withWorkerJson5(userPlugins?: () => PluginOption[], options?: YageJson5Options): () => PluginOption[];
export default yage;
