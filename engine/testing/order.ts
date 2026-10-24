/**
 * Determinism checks for refactors that move work between systems: the system list a world is
 * built from must be its run order, and each tick must draw the same number of random values.
 * Plain functions that throw, so any test runner (or a tool script) can use them.
 *
 * Import as `yage/testing/order`.
 */
import type { SystemImpl } from "minecs";

type SystemClass = typeof SystemImpl<any>;

const nameOf = (system: SystemClass) => system.name || "(anonymous)";

/** `systems` sorted the way a world runs them: by depth, ties in list order. */
export const runOrder = (systems: readonly SystemClass[]): SystemClass[] =>
  systems.map((system, index) => ({ system, index })).sort((a, b) => a.system.depth - b.system.depth || a.index - b.index).map(({ system }) => system);

/** Throws unless `systems` is already in run order (depth ascending), naming the first system out of place. */
export const assertRunOrder = (systems: readonly SystemClass[], label = "systems"): void => {
  const ordered = runOrder(systems);
  const at = ordered.findIndex((system, i) => system !== systems[i]);
  if (at < 0) return;
  throw new Error(
    `${label}: listed ${nameOf(systems[at])} (depth ${systems[at].depth}) at ${at}, but ${nameOf(ordered[at])} (depth ${ordered[at].depth}) runs there. ` +
      `Run order: ${ordered.map((s) => `${nameOf(s)}@${s.depth}`).join(", ")}`
  );
};

type StackClass = SystemClass & { stack?: string; stackDepth?: number };

/** `systems` sorted the way `runStack` (yage/world/stacks) runs a named stack: by stackDepth, ties by class name. */
export const stackRunOrder = (systems: readonly SystemClass[]): SystemClass[] =>
  systems
    .map((system, index) => ({ system: system as StackClass, index }))
    .sort((a, b) => (a.system.stackDepth ?? 0) - (b.system.stackDepth ?? 0) || nameOf(a.system).localeCompare(nameOf(b.system)) || a.index - b.index)
    .map(({ system }) => system);

/** Throws unless `systems` all belong to stack `stack` and are listed in the order runStack runs them. */
export const assertStackOrder = (systems: readonly SystemClass[], stack: string, label = `stack ${stack}`): void => {
  const stray = systems.find((system) => (system as StackClass).stack !== stack || system.depth >= 0);
  if (stray) throw new Error(`${label}: ${nameOf(stray)} is not a "${stack}" stack system (stack ${(stray as StackClass).stack ?? "unset"}, depth ${stray.depth})`);
  const ordered = stackRunOrder(systems);
  const at = ordered.findIndex((system, i) => system !== systems[i]);
  if (at < 0) return;
  const depthOf = (s: SystemClass) => (s as StackClass).stackDepth ?? 0;
  throw new Error(
    `${label}: listed ${nameOf(systems[at])} (stackDepth ${depthOf(systems[at])}) at ${at}, but ${nameOf(ordered[at])} (stackDepth ${depthOf(ordered[at])}) runs there. ` +
      `Run order: ${ordered.map((s) => `${nameOf(s)}@${depthOf(s)}`).join(", ")}`
  );
};

export interface CountingRandom {
  /** Draws from the source and counts the draw. */
  random: () => number;
  /** Draws so far. */
  readonly draws: number;
}

/** Wraps a random source so tests can count its draws. */
export const countingRandom = (source: () => number): CountingRandom => {
  let draws = 0;
  return {
    random: () => {
      draws++;
      return source();
    },
    get draws() {
      return draws;
    },
  };
};

/** Runs `step(tick)` for ticks 0..ticks-1 and returns how many draws each tick took. */
export const drawsPerTick = (counter: CountingRandom, ticks: number, step: (tick: number) => void): number[] => {
  const out: number[] = [];
  for (let tick = 0; tick < ticks; tick++) {
    const before = counter.draws;
    step(tick);
    out.push(counter.draws - before);
  }
  return out;
};

/** Throws unless each tick draws exactly `expected[tick]` values, naming the first tick that differs. */
export const assertDrawsPerTick = (counter: CountingRandom, expected: readonly number[], step: (tick: number) => void, label = "random draws"): void => {
  const got = drawsPerTick(counter, expected.length, step);
  const at = got.findIndex((n, i) => n !== expected[i]);
  if (at >= 0) throw new Error(`${label}: tick ${at} drew ${got[at]}, expected ${expected[at]} (per tick: ${got.join(",")} vs ${expected.join(",")})`);
};
