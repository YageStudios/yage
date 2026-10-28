import { Component, Schema, System, SystemImpl, addComponent, addEntity, defaultValue, type, type World } from "minecs";
import { describe, expect, it } from "vitest";
import { stepChunkWorld, type StepContext } from "../../engine/streaming/host";
import { leanWorldType } from "../../engine/world/lean";

@Component()
class ScheduleRuns extends Schema {
  @type("number") @defaultValue(0) every: number;
  @type("number") @defaultValue(0) third: number;
  @type(["number"]) ticks: number[];
}

@System(ScheduleRuns)
class ScheduleEvery extends SystemImpl<World> {
  static depth = 1;
  static runEmpty = true;
  runAll(world: World) {
    for (const eid of this.query(world)) world(ScheduleRuns, eid).every++;
  }
}

@System(ScheduleRuns)
class ScheduleThird extends SystemImpl<World> {
  static depth = 2;
  static frameMod = 3;
  static frameModOffset = 2;
  runAll(world: World) {
    for (const eid of this.query(world)) {
      world(ScheduleRuns, eid).third++;
      world(ScheduleRuns, eid).ticks.push(world.frame);
    }
  }
}

const Chunk = leanWorldType({ size: 8, systems: [ScheduleEvery, ScheduleThird] });
const ctx = (tick: number, ticks = 1): StepContext => ({ tick, ticks, dt: ticks / 10, space: 0, cx: 0, cy: 0, hot: ticks === 1 });
const chunk = () => {
  const world = Chunk.create();
  const eid = addEntity(world);
  addComponent(world, ScheduleRuns, eid, { ticks: [] });
  return { world, runs: () => world(ScheduleRuns, eid) };
};

describe("stepChunkWorld", () => {
  it("schedules frameMod systems by the run's tick, whenever the chunk was made", () => {
    // Two chunks made at different ticks run the scheduled system on the same ticks (3, 6, 9, ...).
    const early = chunk();
    const late = chunk();
    for (let tick = 1; tick <= 12; tick++) stepChunkWorld(early.world, ctx(tick));
    for (let tick = 5; tick <= 12; tick++) stepChunkWorld(late.world, ctx(tick));
    expect(early.runs().ticks).toEqual([3, 6, 9, 12]);
    expect(late.runs().ticks).toEqual([6, 9, 12]);
    expect(early.runs().every).toBe(12);
    expect(late.world.frame).toBe(12);
  });

  it("runs a scheduled system on a warm step that covers one of its ticks", () => {
    const warm = chunk();
    // Ticks 1-8 (covers 3 and 6: runs once), 9 (runs), 10-11 (none of its ticks), 12-13 (12: runs).
    stepChunkWorld(warm.world, ctx(8, 8));
    stepChunkWorld(warm.world, ctx(9, 1));
    stepChunkWorld(warm.world, ctx(11, 2));
    stepChunkWorld(warm.world, ctx(13, 2));
    expect(warm.runs().ticks).toEqual([8, 9, 13]);
    expect(warm.runs().every).toBe(4);
  });
});
