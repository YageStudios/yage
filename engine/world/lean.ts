/**
 * Lean worlds: minecs worlds that register only the components and systems you list, instead of
 * every @Component and @System loaded in the process. Meant for workers and chunk simulations
 * that hold thousands of small worlds.
 *
 * Import this module as `yage/world/lean`. It imports only minecs, so a worker that imports it
 * (plus `yage/entity/definitions` and its own schemas and systems) does not load the engine's
 * registry, GameModel, AssetLoader, Pixi or Rapier.
 */
import {
  createWorld,
  deserializeWorld,
  getComponentByType,
  type CreateWorldOptions,
  type DrawSystemImpl,
  type Schema,
  type SystemImpl,
  type World,
} from "minecs";

type AnySystem = typeof SystemImpl<any> | typeof DrawSystemImpl<any>;

export interface LeanWorldSpec {
  /** Entity capacity of each world. Default 1000 (minecs' default). */
  size?: number;
  /** Components to register. The components each listed system queries are added for you. */
  components?: readonly (typeof Schema)[];
  /** Systems to create, run in minecs' usual depth/query order whatever order they are listed in. */
  systems?: readonly AnySystem[];
}

export interface LeanWorldType {
  /** The registered components: the listed ones plus every component the systems query. */
  readonly components: readonly (typeof Schema)[];
  readonly systems: readonly AnySystem[];
  /** The options to pass to minecs' createWorld / deserializeWorld yourself. */
  readonly options: CreateWorldOptions;
  /** A new empty world. `size` overrides the spec's size. */
  create(size?: number): World;
  /** A world read from serializeWorld output (binary, base64 or JSON), registering only this spec. */
  deserialize(payload: ArrayBuffer | ArrayBufferView | string | object): World;
}

/** The components a system's query names, resolved to their schemas. */
export const systemComponents = (system: AnySystem): (typeof Schema)[] => {
  const key = (system as unknown as { queryKey?: string }).queryKey ?? "";
  if (!key) return [];
  return key.split("|").map((type) => {
    const schema = getComponentByType(type) as typeof Schema | undefined;
    if (!schema) throw new Error(`yage lean world: system ${system.name} queries component ${type}, which no loaded @Component defines`);
    return schema;
  });
};

/**
 * Resolves a spec once so every world made from it shares the same component and system lists.
 * Use it for chunk worlds: `const Chunk = leanWorldType({ components, systems });` then
 * `Chunk.create()` per chunk and `Chunk.deserialize(bytes)` on load.
 */
export const leanWorldType = (spec: LeanWorldSpec = {}): LeanWorldType => {
  const systems = [...new Set(spec.systems ?? [])];
  const components = [...new Set([...(spec.components ?? []), ...systems.flatMap(systemComponents)])];
  for (const component of components) {
    if (typeof component !== "function" || typeof (component as any).type !== "string") {
      throw new Error(`yage lean world: ${String(component)} is not a @Component schema`);
    }
  }
  const options: CreateWorldOptions = Object.freeze({ components, systems });
  return Object.freeze({
    components,
    systems,
    options,
    create: (size?: number) => createWorld(size ?? spec.size, options),
    deserialize: (payload: ArrayBuffer | ArrayBufferView | string | object) => deserializeWorld(payload as any, options) as World,
  });
};

/** One lean world. For many worlds of the same shape, make a `leanWorldType` once instead. */
export const createLeanWorld = (spec: LeanWorldSpec = {}): World => leanWorldType(spec).create();

/** Reads serializeWorld output into a lean world registering only `spec`'s components and systems. */
export const deserializeLeanWorld = (payload: ArrayBuffer | ArrayBufferView | string | object, spec: LeanWorldSpec = {}): World =>
  leanWorldType(spec).deserialize(payload);

export { isComponentRegistered, serializeWorld, SerialMode, deleteWorld, stepWorld, stepWorldDraw } from "minecs";
export type { CreateWorldOptions };
