import type { Plugin } from "vite";

export interface YageJson5Options { namedExports?: boolean }
export interface YageViteOptions {
  /** Select TypeScript source exports in dev AND production builds. Default true. */
  source?: boolean;
  /** Reload the page on engine source/asset edits, additions and deletions. Default true. */
  reload?: boolean;
  /** Enable JSON5/JSONC imports, leaving ?raw and ?url untouched. Default true. */
  json5?: boolean | YageJson5Options;
}
export declare function yage(options?: YageViteOptions): Plugin[];
export declare function yageJson5(options?: YageJson5Options): Plugin;
export default yage;
