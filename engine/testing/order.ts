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
