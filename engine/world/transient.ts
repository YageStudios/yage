/**
 * One-frame entities: an event or a request spawned as an entity object ("a toast", "a sound
 * cue") that the systems which care find by query during the frame, and that is gone after it.
 *
 * spawnTransient spawns a compiled definition and tags it Transient; TransientCleanup (a draw
 * system that runs last) removes every Transient entity at the end of the frame's draw step, so a
 * transient spawned during the step or the draw is seen by every later system that frame. A
 * world that only steps (no draw) calls clearTransients itself.
 *
 * Import as `yage/world/transient`; add Transient and TransientCleanup to the world's spec.
 */
import { addComponent, Component, defaultValue, defineQuery, DrawSystemImpl, removeEntity, Schema, System, type, type World } from "minecs";
import type { CompiledEntity, SpawnContext } from "yage/entity/definitions/compile";

@Component("Transient")
export class Transient extends Schema {
  /** How many transients this world had spawned before this one: their spawn order. */
  @type("number")
  @defaultValue(0)
  order: number;
}

const counts = new WeakMap<World, number>();

/** Spawns `definition` as a one-frame entity; returns its eid. */
export const spawnTransient = (world: World, definition: CompiledEntity, ctx?: SpawnContext): number => {
  const eid = definition.spawn(world, ctx);
  const order = counts.get(world) ?? 0;
  counts.set(world, order + 1);
  addComponent(world, Transient as any, eid, { order } as any);
  return eid;
};

const transients = defineQuery([Transient as any]);
const withSchema = new Map<typeof Schema, ReturnType<typeof defineQuery>>();

/** This frame's transients holding `schema`, in spawn order (query order is not spawn order once entities are reused). */
export const transientsOf = (world: World, schema: typeof Schema): number[] => {
  let query = withSchema.get(schema);
  if (!query) withSchema.set(schema, (query = defineQuery([schema as any, Transient as any])));
  const order = (eid: number) => (world(Transient as any, eid) as Transient).order;
  return [...(query(world) as number[])].sort((a, b) => order(a) - order(b));
};

/** Removes every transient entity now. */
export const clearTransients = (world: World): void => {
  for (const eid of [...(transients(world) as number[])]) removeEntity(world, eid);
};

@System(Transient)
export class TransientCleanup extends DrawSystemImpl<World> {
  /** Last of the frame: everything else has seen this frame's transients. */
  static depth = Number.MAX_SAFE_INTEGER;
  runAll(world: World) {
    clearTransients(world);
  }
}
