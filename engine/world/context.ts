/**
 * A lean world's transient singleton state lives in a companion ECS world, outside entity rows
 * that may be serialized or transferred. It uses real schemas/storage, and never changes the
 * simulation world's ids, queries or wire format. Restoring a world initializes fresh context.
 */
import { addComponent, addEntity, createWorld, deleteWorld as deleteEcsWorld, type Constructor, type Schema, type World } from "minecs";

export interface WorldContextSpec {
  components: readonly (typeof Schema)[];
  /** Populate object fields and other runtime state after schema defaults have been applied. */
  initialize?(context: World, entity: number): void;
  /** Release borrowed runtime resources before the companion storage is freed. */
  dispose?(context: World, entity: number): void;
}

type Context = { spec: WorldContextSpec; world: World | null; entity: number; accessors: Map<Constructor<Schema>, Schema> };
const CONTEXT = Symbol("yage world context");
const DISPOSED = Symbol("yage disposed world");
type ContextOwner = World & { [CONTEXT]?: Context; [DISPOSED]?: boolean };

/** Attach once; repeated calls preserve this world's state. All context is explicitly transient. */
export const initializeWorldContext = (world: World, spec: WorldContextSpec): void => {
  const owner = world as ContextOwner;
  if (owner[DISPOSED]) throw new Error("yage world context: world is disposed");
  if (owner[CONTEXT]) return;
  const context = createWorld(1, { components: [...spec.components], systems: [] });
  const entity = addEntity(context);
  try {
    for (const schema of spec.components) addComponent(context, schema, entity);
    spec.initialize?.(context, entity);
  } catch (error) {
    try {
      spec.dispose?.(context, entity);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "yage world context: initialization and cleanup failed");
    } finally {
      deleteEcsWorld(context);
    }
    throw error;
  }
  owner[CONTEXT] = { spec, world: context, entity, accessors: new Map() };
};

/** Access the actual schema component on the companion singleton entity. */
export const worldContext = <T extends Schema>(world: World, schema: Constructor<T>): T => {
  const context = (world as ContextOwner)[CONTEXT];
  if (!context?.world) throw new Error("yage world context: no live context");
  if (!context.world.componentMap.has(schema as unknown as typeof Schema)) throw new Error(`yage world context: unregistered schema ${schema.name}`);
  let accessor = context.accessors.get(schema) as T | undefined;
  if (!accessor) {
    const component = context.world(schema);
    const metadata = component.schema.schema.properties;
    accessor = new Proxy(context.world(schema, context.entity), {
      get(target, field) {
        if (!context.world) throw new Error("yage world context: accessor belongs to a disposed context");
        return Reflect.get(target, field);
      },
      set(target, field, value) {
        if (!context.world) throw new Error("yage world context: accessor belongs to a disposed context");
        // minECS copies typed-array assignments for ordinary entity accessors. Context object
        // fields own replaceable buffers (and nullable terrain), so they replace the slot instead.
        if (typeof field === "string" && metadata[field]?.type === "object") {
          (component.store as Record<string, unknown[]>)[field][context.entity] = value;
          return true;
        }
        return Reflect.set(target, field, value);
      },
    });
    context.accessors.set(schema, accessor);
  }
  return accessor;
};

/** Dispose context storage once, retaining its declaration so it may be reset explicitly. */
export const disposeWorldContext = (world: World): void => {
  const context = (world as ContextOwner)[CONTEXT];
  if (!context?.world) return;
  const storage = context.world;
  context.world = null;
  context.accessors.clear();
  try { context.spec.dispose?.(storage, context.entity); } finally { deleteEcsWorld(storage); }
};

/** Fresh schema defaults and initialization; old transient state is discarded. */
export const resetWorldContext = (world: World): void => {
  const owner = world as ContextOwner;
  const context = owner[CONTEXT];
  if (!context) throw new Error("yage world context: no declaration to reset");
  disposeWorldContext(world);
  delete owner[CONTEXT];
  initializeWorldContext(world, context.spec);
};

/** Lean deletion frees both ECS worlds and is safe when lifecycle paths meet twice. */
export const deleteWorld = (world: World): void => {
  const owner = world as ContextOwner;
  if (owner[DISPOSED]) return;
  owner[DISPOSED] = true;
  try { disposeWorldContext(world); } finally { deleteEcsWorld(world); }
};
