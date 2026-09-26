import { batch, signal, type Readable, type Signal } from "./reactive";

const forbidden = new Set(["__proto__", "prototype", "constructor"]);
export function pathSegments(path: string): readonly string[] {
  if (!path || path.length > 512) throw new Error(`UIF_PATH: invalid path ${JSON.stringify(path)}`);
  const parts = path.split(".");
  if (parts.some(part => !/^(?:[A-Za-z_$][\w$-]*|0|[1-9]\d*)$/.test(part) || forbidden.has(part))) {
    throw new Error(`UIF_PATH: unsafe or invalid path ${JSON.stringify(path)}`);
  }
  return parts;
}
export function getPath(value: unknown, parts: readonly string[]): unknown {
  for (const part of parts) {
    if (!value || typeof value !== "object" || !Object.prototype.hasOwnProperty.call(value, part)) return undefined;
    value = (value as Record<string, unknown>)[part];
  }
  return value;
}
function replacePath(value: unknown, parts: readonly string[], next: unknown, index = 0): unknown {
  if (index === parts.length) return next;
  const part = parts[index];
  if (Array.isArray(value)) {
    if (!/^(0|[1-9]\d*)$/.test(part) || Number(part) >= value.length) {
      throw new Error("UIF_PATH: array updates require an existing numeric index; replace the array to resize");
    }
    const result = value.slice();
    result[Number(part)] = replacePath(value[Number(part)], parts, next, index + 1);
    return result;
  }
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null) {
    throw new Error("UIF_PATH: parent must be a plain object or array");
  }
  return { ...value, [part]: replacePath(getPath(value, [part]), parts, next, index + 1) };
}
interface Trie { children: Map<string, Trie>; cell?: Signal<unknown>; }

/** Immutable snapshots with path-indexed invalidation. Values supplied by callers must be treated as immutable. */
export class Model<T extends object> {
  private trie: Trie = { children: new Map() };
  private dead = false;
  constructor(private state: T) {}
  private check(): void { if (this.dead) throw new Error("UIF_MODEL_DISPOSED"); }
  snapshot(): Readonly<T> { this.check(); return this.state; }
  select<V = unknown>(path: string): Readable<V> {
    this.check();
    const parts = pathSegments(path);
    let node = this.trie;
    for (const part of parts) {
      let child = node.children.get(part);
      if (!child) node.children.set(part, child = { children: new Map() });
      node = child;
    }
    if (!node.cell) node.cell = signal(getPath(this.state, parts));
    return node.cell as Readable<V>;
  }
  get<V = unknown>(path: string): V { return this.select<V>(path).get(); }
  set<K extends keyof T & string>(path: K, value: T[K]): boolean;
  set(path: string, value: unknown): boolean;
  set(path: string, value: unknown): boolean {
    this.check();
    const parts = pathSegments(path);
    // Validate even no-op writes: array.length is not a writable model path.
    let parent: unknown = this.state;
    for (let index = 0; index < parts.length; index++) {
      const part = parts[index];
      if (Array.isArray(parent)) {
        if (!/^(0|[1-9]\d*)$/.test(part) || Number(part) >= parent.length) throw new Error("UIF_PATH: expected an existing array index");
      } else if (!parent || typeof parent !== "object" || Object.getPrototypeOf(parent) !== Object.prototype && Object.getPrototypeOf(parent) !== null) {
        throw new Error("UIF_PATH: parent must be a plain object or array");
      }
      if (index < parts.length - 1) parent = getPath(parent, [part]);
    }
    if (Object.is(getPath(this.state, parts), value)) return false;
    this.state = replacePath(this.state, parts, value) as T;
    batch(() => this.notifyPath(parts));
    return true;
  }
  patch(patch: Partial<T>): void {
    // Pre-validate every key before committing any part of the patch.
    const keys = Object.keys(patch);
    keys.forEach(key => {
      if (pathSegments(key).length !== 1) throw new Error("UIF_PATH: patch keys must be top-level properties");
    });
    batch(() => keys.forEach(key => this.set(key, (patch as Record<string, unknown>)[key])));
  }
  replace(state: T): void {
    this.check();
    if (Object.is(this.state, state)) return;
    this.state = state;
    batch(() => this.notifyTree(this.trie, state));
  }
  private notifyTree(node: Trie, value: unknown): void {
    node.cell?.set(value);
    for (const [part, child] of node.children) this.notifyTree(child, getPath(value, [part]));
  }
  private notifyPath(parts: readonly string[]): void {
    let node = this.trie;
    let value: unknown = this.state;
    node.cell?.set(value);
    for (const part of parts) {
      const child = node.children.get(part);
      if (!child) return;
      node = child;
      value = getPath(value, [part]);
      node.cell?.set(value);
    }
    this.notifyTree(node, value);
  }
  /** Selectors are interned for the lifetime of a model; dispose screen-specific models on screen exit. */
  dispose(): void { this.dead = true; this.trie.children.clear(); }
}
export function model<T extends object>(initial: T): Model<T> { return new Model(initial); }
