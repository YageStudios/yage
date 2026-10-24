import toposort from "toposort";
import type { ComponentData } from "./types";

/** Component type → the component types it must be added after. */
export type DependencyResolver = (type: string) => readonly string[] | undefined;

type SystemLike = {
  dependencies?: readonly string[];
  prototype?: { dependencies?: readonly string[] };
  queryKey?: string;
};

/**
 * Builds a DependencyResolver from system classes or instances. A system's `dependencies` (a static
 * field, an instance field or a prototype field) apply to every component its query names; pass
 * `componentsOf` when the system's query components are not in its minecs queryKey.
 */
export const systemDependencies = (
  systems: readonly unknown[],
  componentsOf: (system: any) => readonly string[] = (s) => String(s.queryKey ?? s.constructor?.queryKey ?? "").split("|").filter(Boolean)
): DependencyResolver => {
  const map = new Map<string, Set<string>>();
  for (const s of systems as SystemLike[]) {
    let deps = s.dependencies ?? s.prototype?.dependencies;
    if (!deps && typeof s === "function") {
      // Instance fields only exist on instances; read them from a bare instance when cheap.
      try {
        deps = (new (s as any)(() => []) as SystemLike).dependencies;
      } catch {
        deps = undefined;
      }
    }
    if (!deps?.length) continue;
    for (const type of componentsOf(s)) {
      const set = map.get(type) ?? new Set<string>();
      deps.forEach((d) => set.add(d));
      map.set(type, set);
    }
  }
  return (type) => (map.has(type) ? Array.from(map.get(type)!) : undefined);
};

/**
 * Orders components so each comes after the components its systems depend on. Components without
 * dependencies keep their order and come first; the rest follow in dependency order. Same order as
 * EntityFactory.mapEntityComponent, without duplicates.
 */
export const orderComponents = <C extends ComponentData>(components: readonly C[], dependencies: DependencyResolver): C[] => {
  const order: string[] = [];
  const edges: [string, string][] = [];
  const byType = new Map<string, C>();
  for (const c of components) {
    byType.set(c.type, c);
    const deps = (dependencies(c.type) ?? []).filter((d) => d && d !== c.type);
    if (!deps.length) order.push(c.type);
    else for (const d of deps) edges.push([c.type, d]);
  }
  order.push(...toposort(edges).reverse());
  const seen = new Set<string>();
  const result: C[] = [];
  for (const type of order) {
    const c = byType.get(type);
    if (c && !seen.has(type)) {
      seen.add(type);
      result.push(c);
    }
  }
  return result;
};
