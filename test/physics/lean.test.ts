import { addComponent, addEntity, Component, defaultValue, removeEntity, Schema, SerialMode, serializeWorld, stepWorld, System, type, type World } from "minecs";
import { beforeAll, describe, expect, test, vi } from "vitest";
import {
  addFixedBox,
  armLeanPhysics,
  LeanBody,
  LeanBodyKind,
  leanPhysicsLive,
  leanPhysicsOf,
  LeanPhysicsSystem,
  LeanPhysics,
  liveLeanPhysicsWorlds,
  loadRapier,
  rapierLoaded,
  releaseLeanPhysics,
  releaseLeanPhysicsState,
} from "yage/physics/lean";
import { leanWorldType } from "yage/world/lean";

@Component("PhysicsTestPos")
class PhysicsTestPos extends Schema {
  @type("float32") @defaultValue(0) x: number;
  @type("float32") @defaultValue(0) y: number;
}

/** Walks every entity toward its goal at a fixed speed: the game's own movement, before contact. */
@Component("PhysicsTestGoal")
class PhysicsTestGoal extends Schema {
  @type("float32") @defaultValue(0) x: number;
  @type("float32") @defaultValue(0) y: number;
}

@System(LeanBody, PhysicsTestPos)
class Physics extends LeanPhysicsSystem {
  static depth = 10;
  static position = { component: PhysicsTestPos, x: "x", y: "y" };
}

const Kind = leanWorldType({
  size: 64,
  components: [PhysicsTestPos, PhysicsTestGoal, LeanBody],
  systems: [Physics],
  context: {
    components: [LeanPhysics],
    dispose(context, entity) {
      releaseLeanPhysicsState(context(LeanPhysics, entity));
    },
  },
});

const SPEED = 20;
const DT = 0.1;

const spawn = (world: World, x: number, y: number, gx: number, gy: number, body: Partial<LeanBody> = {}) => {
  const eid = addEntity(world);
  addComponent(world, PhysicsTestPos, eid, { x, y });
  addComponent(world, PhysicsTestGoal, eid, { x: gx, y: gy });
  addComponent(world, LeanBody, eid, { radius: 1, maxSpeed: SPEED * 1.5, ...body });
  return eid;
};

/** The game's step: move toward goals, then (armed) let Rapier resolve contact. */
const step = (world: World, armed = true, build?: (state: LeanPhysics) => void) => {
  const pos = world(PhysicsTestPos).store;
  const goal = world(PhysicsTestGoal).store;
  for (const eid of world.entitySparseSet.dense as number[]) {
    const dx = goal.x[eid] - pos.x[eid];
    const dy = goal.y[eid] - pos.y[eid];
    const d = Math.hypot(dx, dy);
    const travel = Math.min(d, SPEED * DT);
    if (d > 0) {
      pos.x[eid] += (dx / d) * travel;
      pos.y[eid] += (dy / d) * travel;
    }
  }
  if (armed) expect(armLeanPhysics(world, { dt: DT, build })).toBe(true);
  stepWorld(world);
};

const wall = (state: LeanPhysics) => addFixedBox(state, 10, 0, 1, 10);

beforeAll(async () => {
  // test/setup.ts's fake window traps Rapier's wasm mid-step; workers and node have the real globals.
  vi.stubGlobal("window", globalThis);
  await loadRapier();
});

describe("lean physics", () => {
  test("steps a dense chunk with more than sixteen thousand colliders", () => {
    const world = Kind.create(6000);
    try {
      for (let i = 0; i < 5377; i++) spawn(world, (i % 100) * 5, Math.floor(i / 100) * 5, (i % 100) * 5, Math.floor(i / 100) * 5,
        { kind: i < 1345 ? LeanBodyKind.Off : LeanBodyKind.Dynamic });
      expect(() => step(world, true, state => {
        for (let i = 0; i < 11747; i++) addFixedBox(state, (i % 128) * 5 + 2, Math.floor(i / 128) * 5 + 2, 0.1, 0.1);
      })).not.toThrow();
      expect(leanPhysicsOf(world).bodies!.size).toBe(5377);
    } finally { Kind.dispose(world); }
  });
  test("rejects invalid positions even on disabled bodies before passing them to Rapier", () => {
    const world = Kind.create();
    try {
      const eid = spawn(world, Number.NaN, 0, 0, 0, { kind: LeanBodyKind.Off });
      expect(armLeanPhysics(world, { dt: DT })).toBe(true);
      expect(() => stepWorld(world)).toThrow(`Invalid physics position for entity ${eid}: NaN, 0 (kind ${LeanBodyKind.Off})`);
      expect(leanPhysicsOf(world).bodies!.size).toBe(0);
      world(PhysicsTestPos).store.x[eid] = 0;
      expect(armLeanPhysics(world, { dt: DT })).toBe(true);
      expect(() => stepWorld(world)).not.toThrow();
    } finally { Kind.dispose(world); }
  });
  test("loads Rapier once without the asset loader", async () => {
    expect(rapierLoaded()).toBe(true);
    const again = await loadRapier();
    expect(again).toBe(await loadRapier());
  });

  test("a fixed box stops a walker; the walker keeps its own heading", () => {
    const world = Kind.create();
    const eid = spawn(world, 0, 0, 20, 0);
    for (let i = 0; i < 40; i++) step(world, true, wall);
    const x = world(PhysicsTestPos).store.x[eid];
    // Wall face at 9, body radius 1: no further than 8 (Rapier's contact skin aside).
    expect(x).toBeLessThan(8.05);
    expect(x).toBeGreaterThan(7.5);
    expect(world(LeanBody).store.reach[eid]).toBeLessThan(0.2);
    Kind.dispose(world);
  });

  test("walkers heading for the same spot push each other apart", () => {
    const world = Kind.create();
    const a = spawn(world, -5, 0, 0, 0);
    const b = spawn(world, 5, 0, 0, 0);
    for (let i = 0; i < 30; i++) step(world);
    const pos = world(PhysicsTestPos).store;
    expect(Math.hypot(pos.x[a] - pos.x[b], pos.y[a] - pos.y[b])).toBeGreaterThan(1.9);
    Kind.dispose(world);
  });

  test("kinematic bodies go exactly where they're put and shove dynamic ones; off bodies ignore contact", () => {
    const world = Kind.create();
    const k = spawn(world, -5, 0, 5, 0, { kind: LeanBodyKind.Kinematic });
    const d = spawn(world, 0, 0, 0, 0);
    const off = spawn(world, 0, 3, 20, 3, { kind: LeanBodyKind.Off });
    for (let i = 0; i < 10; i++) step(world, true, (state) => addFixedBox(state, 10, 3, 1, 1));
    const pos = world(PhysicsTestPos).store;
    expect(pos.x[k]).toBeCloseTo(5, 5);
    expect(pos.x[d]).toBeGreaterThan(6);
    expect(pos.x[off]).toBeCloseTo(20, 5);
    Kind.dispose(world);
  });

  test("a dominant body holds its spot against walkers; they go round it", () => {
    const world = Kind.create();
    const seated = spawn(world, 0, 0, 0, 0, { dominance: 1 });
    const walker = spawn(world, -6, 0.2, 6, 0.2);
    for (let i = 0; i < 40; i++) step(world);
    const pos = world(PhysicsTestPos).store;
    expect(Math.hypot(pos.x[seated], pos.y[seated])).toBeLessThan(0.05);
    expect(pos.x[walker]).toBeGreaterThan(5);
    Kind.dispose(world);
  });

  test("a body past its slack catches up through fixed colliders", () => {
    const world = Kind.create();
    const eid = spawn(world, 0, 0, 20, 0, { slack: 4 });
    // The game puts it far past the wall (a schedule that moved on): it ghosts through.
    world(PhysicsTestPos).store.x[eid] = 0;
    step(world, true, wall);
    world(PhysicsTestGoal).store.x[eid] = 20;
    world(PhysicsTestPos).store.x[eid] = 20;
    for (let i = 0; i < 40; i++) {
      world(PhysicsTestPos).store.x[eid] = 20;
      armLeanPhysics(world, { dt: DT });
      stepWorld(world);
    }
    expect(world(PhysicsTestPos).store.x[eid]).toBeCloseTo(20, 3);
    Kind.dispose(world);
  });

  test("unarmed steps never touch Rapier or the positions", () => {
    const world = Kind.create();
    const eid = spawn(world, 0, 0, 20, 0);
    for (let i = 0; i < 40; i++) step(world, false);
    expect(leanPhysicsLive(world)).toBe(false);
    expect(world(PhysicsTestPos).store.x[eid]).toBeCloseTo(20, 4);
    // Armed once, then unarmed again: the second step is the game's alone.
    step(world, true, wall);
    const x = world(PhysicsTestPos).store.x[eid];
    stepWorld(world);
    expect(world(PhysicsTestPos).store.x[eid]).toBe(x);
    Kind.dispose(world);
  });

  test("runs repeat exactly", () => {
    const run = () => {
      const world = Kind.create();
      for (let i = 0; i < 12; i++) spawn(world, (i % 4) * 2.5, Math.floor(i / 4) * 2.5, 15 - i, (i * 7) % 5);
      // Out-of-order removal and reuse of entity ids.
      removeEntity(world, 3);
      for (let i = 0; i < 25; i++) step(world, true, wall);
      spawn(world, 1, 1, 12, 0);
      for (let i = 0; i < 25; i++) step(world, true, wall);
      const bytes = new Uint8Array(serializeWorld(SerialMode.BINARY, world) as ArrayBuffer);
      Kind.dispose(world);
      return bytes;
    };
    expect(run()).toEqual(run());
  });

  test("bodies go with their entities, and Rapier worlds are freed with their lean worlds", () => {
    const before = liveLeanPhysicsWorlds();
    const worlds = [Kind.create(), Kind.create(), Kind.create()];
    for (const world of worlds) {
      spawn(world, 0, 0, 5, 0);
      const gone = spawn(world, 3, 3, 5, 0);
      step(world, true, wall);
      expect(leanPhysicsOf(world).bodies!.size).toBe(2);
      expect(leanPhysicsOf(world).fixed).toBe(1);
      removeEntity(world, gone);
      expect(leanPhysicsOf(world).bodies!.size).toBe(1);
    }
    // Each lean world has its own Rapier world.
    expect(new Set(worlds.map((w) => leanPhysicsOf(w).world)).size).toBe(3);
    expect(liveLeanPhysicsWorlds()).toBe(before + 3);
    releaseLeanPhysics(worlds[0]);
    expect(leanPhysicsLive(worlds[0])).toBe(false);
    expect(liveLeanPhysicsWorlds()).toBe(before + 2);
    // Released and armed again: rebuilt from scratch.
    step(worlds[0], true, wall);
    expect(leanPhysicsOf(worlds[0]).bodies!.size).toBe(1);
    for (const world of worlds) Kind.dispose(world);
    expect(liveLeanPhysicsWorlds()).toBe(before);
  });
});
