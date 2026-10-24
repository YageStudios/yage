import type { ComponentData, EntityDefinition, FlexibleEntityDefinition } from "./types";

const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));

const normalizeComponents = (components: FlexibleEntityDefinition["components"]): ComponentData[] | undefined =>
  components?.map((c) => (typeof c === "string" ? { type: c } : c));

const parentsOf = (definition: FlexibleEntityDefinition): string[] =>
  definition.inherits === undefined ? [] : typeof definition.inherits === "string" ? [definition.inherits] : definition.inherits;

/**
 * Merges `parent` under `child`: the child's type wins, children concatenate (parent's first),
 * components merge by `type` with the child's component replacing the parent's whole and keeping
 * the parent's position.
 */
export const inheritDefinition = (parent: EntityDefinition, child: EntityDefinition): EntityDefinition => {
  const merged: EntityDefinition = copy(child);
  merged.type = merged.type ?? parent.type;
  merged.children = [...(parent.children ?? []), ...(merged.children ?? [])];
  const parentComponents = parent.components ?? [];
  if (parentComponents.length && merged.components?.length) {
    const byType = new Map<string, ComponentData>();
    for (const c of copy(parentComponents)) byType.set(c.type, c);
    for (const c of merged.components) byType.set(c.type, c);
    merged.components = Array.from(byType.values());
  } else if (parentComponents.length) {
    merged.components = copy(parentComponents);
  }
  return merged;
};

/**
 * Resolves inheritance for a list of definitions. Pure: the input is not mutated and nothing is
 * cached globally. The result is keyed by lowercased name and keeps the input order. With several
 * parents, later parents override earlier ones and the definition overrides them all. Throws on an unknown parent or an inheritance cycle.
 */
export const resolveDefinitions = (definitions: readonly FlexibleEntityDefinition[]): Map<string, EntityDefinition> => {
  const raw = new Map<string, FlexibleEntityDefinition>();
  for (const definition of definitions) {
    if (!definition || typeof definition.name !== "string") {
      throw new Error(`yage definitions: every entity definition needs a string name (got ${JSON.stringify(definition)})`);
    }
    raw.set(definition.name.toLowerCase(), definition);
  }
  const resolved = new Map<string, EntityDefinition>();
  const visiting = new Set<string>();
  const resolve = (key: string, from?: string): EntityDefinition => {
    const done = resolved.get(key);
    if (done) return done;
    const definition = raw.get(key);
    if (!definition) throw new Error(`yage definitions: "${from}" inherits unknown definition "${key}"`);
    if (visiting.has(key)) throw new Error(`yage definitions: inheritance cycle through "${definition.name}"`);
    visiting.add(key);
    let result: EntityDefinition = copy(definition) as EntityDefinition;
    result.components = normalizeComponents((definition as FlexibleEntityDefinition).components);
    if (result.components === undefined) delete result.components;
    const parents = parentsOf(definition).map((p) => resolve(p.toLowerCase(), definition.name));
    if (parents.length) {
      // Later parents override earlier ones; the definition itself overrides them all.
      const base = parents.reduce((acc, parent) => inheritDefinition(acc, parent));
      result = inheritDefinition(base, result);
    }
    visiting.delete(key);
    resolved.set(key, result);
    return result;
  };
  // Resolve everything first, then rebuild in input order.
  for (const key of raw.keys()) resolve(key);
  const ordered = new Map<string, EntityDefinition>();
  for (const key of raw.keys()) ordered.set(key, resolved.get(key)!);
  return ordered;
};

/**
 * Turns `import.meta.glob(..., { eager: true })` output (or any path → module record) into a flat
 * definition list: sorted by path, `default` unwrapped, and a file holding an array flattened in
 * array order.
 */
export const definitionsFromModules = (modules: Record<string, unknown>): FlexibleEntityDefinition[] =>
  Object.keys(modules)
    .sort()
    .flatMap((path) => {
      const mod = modules[path] as any;
      const value = mod && typeof mod === "object" && "default" in mod ? mod.default : mod;
      return (Array.isArray(value) ? value : [value]) as FlexibleEntityDefinition[];
    });

/** The definition's component of `type`, if any (not copied). */
export const componentOf = (definition: EntityDefinition, type: string): ComponentData | undefined =>
  definition.components?.find((c) => c.type === type);

/** Whether the definition has every one of `types`. */
export const hasComponents = (definition: EntityDefinition, types: readonly string[]): boolean =>
  types.every((type) => definition.components?.some((c) => c.type === type));
