/**
 * Named system stacks: systems that run outside the world's main step, as their own depth-ordered
 * stack, when a hook asks for it (a chunk coming back from storage, a snapshot about to go out).
 *
 * A stack system is a minecs manual system (`static depth = -1`, so stepWorld never runs it) that
 * names its stack and its place in it:
 *
 *   @System(Exposure)
 *   class CatchUp extends SystemImpl<World> {
 *     static depth = -1;
 *     static stack = "restore";
 *     static stackDepth = 10;
 *     runAll(world: World) { ... }
 *   }
 *
 * List it with the world's systems as usual (lean worlds create only listed systems), then the
 * hook calls `runStack(world, "restore")`. Systems run by stackDepth, ties by class name, and
 * each runs when its query matches something or it is `runEmpty`, the same rule as the main step.
 *
 * Import as `yage/world/stacks`.
 */
import type { SystemImpl, World } from "minecs";

/** The statics a stack system declares, beside minecs' own. */
export interface StackSystemClass {
  readonly name: string;
  depth: number;
  runEmpty?: boolean;
  /** The stack the system belongs to. Unset: the main step (or a plain manual system). */
  stack?: string;
  /** Its place in that stack, ascending. */
  stackDepth?: number;
}

const classOf = (system: SystemImpl<any>) => system.constructor as unknown as StackSystemClass;

const stacks = new WeakMap<World, Map<string, SystemImpl<any>[]>>();

/** The systems `world` runs for stack `name`, in run order. Built once per world. */
export const stackSystems = (world: World, name: string): readonly SystemImpl<any>[] => {
  let byName = stacks.get(world);
  if (!byName) stacks.set(world, (byName = new Map()));
  let list = byName.get(name);
  if (list) return list;
  list = world.systems
    .filter((system) => classOf(system).stack === name)
    .map((system, index) => ({ system, index }))
    .sort((a, b) => {
      const A = classOf(a.system);
      const B = classOf(b.system);
      return (A.stackDepth ?? 0) - (B.stackDepth ?? 0) || A.name.localeCompare(B.name) || a.index - b.index;
    })
    .map(({ system }) => system);
  for (const system of list) {
    if (classOf(system).depth >= 0)
      throw new Error(`yage stacks: ${classOf(system).name} is in stack "${name}" but has depth ${classOf(system).depth}; stack systems need depth -1 so the main step skips them`);
  }
  byName.set(name, list);
  return list;
};

/** Runs stack `name` on `world` once, in stackDepth order. */
export const runStack = (world: World, name: string): void => {
  const list = stackSystems(world, name);
  for (let i = 0; i < list.length; i++) {
    const system = list[i];
    if (classOf(system).runEmpty || system.query(world).length) system.runAll(world);
  }
};

/** Drops `world`'s cached stack lists (call on teardown when the world object may be reused). */
export const forgetStacks = (world: World): void => {
  stacks.delete(world);
};
