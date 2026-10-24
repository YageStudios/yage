/**
 * Batched spawning: `addEntities(world, count, components)` adds `count` entities with the same
 * components and static data, the result of addEntity plus addComponent(world, schema, eid, data)
 * per component, but written in bulk. Import as `yage/world/spawn` (minecs only, worker-safe).
 *
 * The batch is validated once (the component data, with the schema's defaults, exactly as
 * addComponent validates it) and each column is filled once per contiguous run of entity ids, so
 * the per-entity cost is the entity id, its mask and its query memberships. Systems' init hooks run
 * per entity, in the order addComponent would run them, after all of that entity's components and
 * data are in place (addComponent runs each hook as soon as its query matches).
 *
 * The bulk path needs flat components (every field a numeric column), static data (numbers and
 * booleans), components already registered in the world, and no delta serializer on it. Anything
 * else falls back to addEntity plus addComponent per entity: same result, at the usual cost.
 */
import { addComponent, addEntity, type Query, type Schema, type SystemImpl, type World, type WorldComponent } from "minecs";

type SchemaClass = typeof Schema;

/** A schema, or a schema with the data to add it with (as addComponent's overrides). */
export type SpawnComponent = SchemaClass | { schema: SchemaClass; data?: Record<string, unknown> };

export interface AddEntitiesOptions {
  /** Called with each new entity after its components (and init hooks) are in place. */
  each?: (eid: number, index: number) => void;
}

// A schema class is a function (with a static `schema`, its JSON schema); a pair is a plain object.
const schemaOf = (component: SpawnComponent): SchemaClass => (typeof component === "function" ? component : component.schema);
const dataOf = (component: SpawnComponent): Record<string, unknown> | undefined => (typeof component === "function" ? undefined : component.data);

interface Plan {
  columns: ArrayLike<number>[];
  values: number[];
  /** Per generation: the bits the entity ends up with. */
  generations: number[];
  masks: number[];
  /** Queries the entity joins, in the order addComponent would add it to them. */
  queries: Query[];
}

const isDeltaTracked = (world: World) => {
  for (const symbol of Object.getOwnPropertySymbols(world)) {
    if (symbol.description === "deltaDirtyState" && (world as any)[symbol]) return true;
  }
  return false;
};

const queryMatches = (query: Query, masks: number[]) => {
  for (let i = 0; i < query.generations.length; i++) {
    const g = query.generations[i];
    const q = query.masks[g];
    if (q && ((masks[g] ?? 0) & q) !== q) return false;
  }
  return true;
};

/** The bulk plan for these components in this world, or null when the batch must use addComponent. */
const planFor = (world: World, components: readonly SpawnComponent[]): Plan | null => {
  if (isDeltaTracked(world)) return null;
  const plan: Plan = { columns: [], values: [], generations: [], masks: [], queries: [] };
  const seen = new Set<WorldComponent>();
  for (const component of components) {
    const c = world.componentMap.get(schemaOf(component));
    if (!c || seen.has(c)) return null;
    seen.add(c);
    const data = dataOf(component);
    const input: Record<string, unknown> = {};
    if (data) {
      for (const key in data) {
        const value = data[key];
        if (key !== "type" && typeof value !== "number" && typeof value !== "boolean") return null;
        input[key] = value;
      }
    }
    // addComponent's validation, once for the batch (Ajv fills the defaults in). Invalid data takes
    // the addComponent path, which throws addComponent's error.
    if (!c.schema.validate(input)) return null;
    const store = c.store as unknown as Record<string, unknown>;
    for (const key of Object.keys(store)) {
      const column = store[key];
      if (!ArrayBuffer.isView(column)) return null;
      const value = input[key];
      plan.columns.push(column as unknown as ArrayLike<number>);
      // A field with no default and no data keeps addComponent's reset value.
      plan.values.push(value === undefined ? 0 : +(value as number));
    }
    plan.masks[c.generationId] = (plan.masks[c.generationId] ?? 0) | c.bitflag;
  }
  // Query order as addComponent's: component by component, each component's queries in order,
  // joining a query as soon as the components so far match it.
  const sofar: number[] = [];
  const joined = new Set<Query>();
  for (const component of components) {
    const c = world.componentMap.get(schemaOf(component))!;
    sofar[c.generationId] = (sofar[c.generationId] ?? 0) | c.bitflag;
    for (const query of c.queries) {
      if (!joined.has(query) && queryMatches(query, sofar)) {
        joined.add(query);
        plan.queries.push(query);
      }
    }
  }
  plan.masks.forEach((mask, g) => mask && plan.generations.push(g));
  return plan;
};

/** addComponent fills defaults into its overrides: each entity gets its own copy. */
const copyData = (component: SpawnComponent): any => {
  const data = dataOf(component);
  return data ? { ...data } : undefined;
};

const addEach = (world: World, count: number, components: readonly SpawnComponent[], options: AddEntitiesOptions, eids: number[]) => {
  for (let i = 0; i < count; i++) {
    const eid = addEntity(world);
    eids.push(eid);
    for (const component of components) addComponent(world, schemaOf(component) as any, eid, copyData(component));
    options.each?.(eid, i);
  }
  return eids;
};

/**
 * Adds `count` entities with `components` (schemas, or `{ schema, data }` for static data) and
 * returns their ids in creation order. Equivalent to addEntity plus addComponent per component,
 * in bulk where it can be (see the module comment). Throws before adding any entity when the world
 * has no room for `count` more.
 */
export const addEntities = (world: World, count: number, components: readonly SpawnComponent[], options: AddEntitiesOptions = {}): number[] => {
  const eids: number[] = [];
  if (count <= 0) return eids;
  if (world.size - world.entityCursor + world.removed.length < count) {
    throw new Error(`yage addEntities: no room for ${count} more entities (size ${world.size})`);
  }
  let plan = planFor(world, components);
  if (!plan) return addEach(world, count, components, options, eids);

  for (let i = 0; i < count; i++) eids.push(addEntity(world));

  // Data first, a column at a time over each run of consecutive ids (fresh ids come in runs).
  const { columns, values } = plan;
  for (let start = 0; start < count; ) {
    let end = start + 1;
    while (end < count && eids[end] === eids[end - 1] + 1) end++;
    const from = eids[start];
    const to = eids[end - 1] + 1;
    for (let k = 0; k < columns.length; k++) (columns[k] as any).fill(values[k], from, to);
    start = end;
  }

  let queryCount = world.queries.size;
  let componentCount = world.componentMap.size;
  for (let i = 0; i < count; i++) {
    const eid = eids[i];
    // A hook defined a query or registered a component: the rest of the batch needs a fresh plan.
    if (world.queries.size !== queryCount || world.componentMap.size !== componentCount) {
      queryCount = world.queries.size;
      componentCount = world.componentMap.size;
      plan = plan && planFor(world, components);
    }
    if (plan) join(world, plan, eid);
    // Its columns are written already; addComponent sees the bits unset and adds it as usual.
    else for (const component of components) addComponent(world, schemaOf(component) as any, eid, copyData(component));
    options.each?.(eid, i);
  }
  return eids;
};

/** The per-entity part of a bulk add (its data is written already): mask bits, queries, init hooks. */
const join = (world: World, plan: Plan, eid: number) => {
  const { generations, masks, queries } = plan;
  for (let k = 0; k < generations.length; k++) world.entityMasks[generations[k]][eid] |= masks[generations[k]];
  for (let k = 0; k < queries.length; k++) {
    const query = queries[k];
    // As addComponent: a recycled id still pending removal from a query stays in it, with no new init.
    query.toRemove.remove(eid);
    if (query.add(eid)) {
      const systems: SystemImpl[] | undefined = world.systemQueryMap.get(query.queryKey);
      if (systems) for (let s = 0; s < systems.length; s++) systems[s].init?.(world, eid);
    }
  }
};
