import {
  Component,
  Schema,
  System,
  SystemImpl,
  addComponent,
  addEntity,
  createDeltaSerializer,
  defaultValue,
  defineQuery,
  removeEntity,
  type,
  type World,
} from "minecs";
import { describe, expect, test } from "vitest";
import { compileEntityDefinition } from "yage/entity/definitions";
import { addEntities, type SpawnComponent } from "yage/world/spawn";
import { leanWorldType } from "yage/world/lean";

@Component("SpawnPos")
class SpawnPos extends Schema {
  @type("float32") @defaultValue(1.5) x: number;
  @type("int16") @defaultValue(-3) y: number;
}
@Component("SpawnLife")
class SpawnLife extends Schema {
  @type("uint8") @defaultValue(255) role: number;
  @type("uint16") home: number;
  @type("boolean") @defaultValue(true) awake: boolean;
}
@Component("SpawnTag")
class SpawnTag extends Schema {}
@Component("SpawnName")
class SpawnName extends Schema {
  @type("string") @defaultValue("anon") name: string;
}

const log: string[] = [];
@System(SpawnPos)
class SpawnMove extends SystemImpl<World> {
  init = (_world: World, eid: number) => void log.push(`move ${eid}`);
}
@System(SpawnPos, SpawnLife)
class SpawnLiving extends SystemImpl<World> {
  init = (world: World, eid: number) => void log.push(`living ${eid} role ${world(SpawnLife, eid).role}`);
}
@System(SpawnLife, SpawnTag)
class SpawnTagged extends SystemImpl<World> {
  init = (_world: World, eid: number) => void log.push(`tagged ${eid}`);
}

const Chunk = leanWorldType({ size: 64, components: [SpawnName], systems: [SpawnMove, SpawnLiving, SpawnTagged] });
const COMPONENTS: SpawnComponent[] = [SpawnPos, { schema: SpawnLife, data: { role: 3 } }, SpawnTag];

/** What addEntities must reproduce: addEntity, then addComponent per component. */
const oneByOne = (world: World, count: number, components = COMPONENTS) => {
  const eids: number[] = [];
  for (let i = 0; i < count; i++) {
    const eid = addEntity(world);
    for (const c of components) {
      if (typeof c !== "function") addComponent(world, c.schema as any, eid, { ...c.data } as any);
      else addComponent(world, c as any, eid);
    }
    eids.push(eid);
  }
  return eids;
};

const state = (world: World, eids: number[]) => ({
  eids,
  masks: world.entityMasks.map((m) => [...m.slice(0, 64)]),
  queries: [SpawnPos, SpawnLife, SpawnTag].map((s) => [...defineQuery([s])(world)].sort((a, b) => a - b)),
  joint: [...defineQuery([SpawnPos, SpawnLife])(world)].sort((a, b) => a - b),
  rows: eids.map((eid) => [world(SpawnPos, eid).x, world(SpawnPos, eid).y, world(SpawnLife, eid).role, world(SpawnLife, eid).home, world(SpawnLife, eid).awake]),
});

/** A world with stale data in recycled ids: entities spawned with other values, then removed. */
const dirtyWorld = () => {
  const world = Chunk.create();
  const old = oneByOne(world, 20, [{ schema: SpawnPos, data: { x: 9, y: 9 } }, { schema: SpawnLife, data: { role: 7, home: 40, awake: false } }]);
  for (const eid of old.slice(0, 12)) removeEntity(world, eid);
  defineQuery([SpawnPos])(world); // commit the removals
  return world;
};

describe("addEntities", () => {
  test("matches addEntity plus addComponent: ids, masks, queries, data and init order, over recycled ids", () => {
    log.length = 0;
    const a = dirtyWorld();
    const expected = state(a, oneByOne(a, 30));
    const expectedLog = log.splice(0);

    const b = dirtyWorld();
    const seen: number[] = [];
    const eids = addEntities(b, 30, COMPONENTS, { each: (eid, i) => seen.push(eid, i) });
    expect(state(b, eids)).toEqual(expected);
    expect(log).toEqual(expectedLog);
    expect(seen).toEqual(eids.flatMap((eid, i) => [eid, i]));
    // Recycled ids first, then fresh ones: more than one run.
    expect(eids.slice(0, 3)).not.toEqual([eids[0], eids[0] + 1, eids[0] + 2]);
    expect(expected.rows[0]).toEqual([1.5, -3, 3, 0, true]);
  });

  test("init hooks see the whole entity and its data", () => {
    log.length = 0;
    addEntities(Chunk.create(), 1, COMPONENTS);
    // one by one, SpawnLiving would see role 255 (the default) if Life's data came later; here it is in.
    expect(log).toEqual(["move 0", "living 0 role 3", "tagged 0"]);
  });

  test("falls back to addComponent for non-numeric components, delta-tracked worlds and invalid data", () => {
    const world = Chunk.create();
    const [eid] = addEntities(world, 2, [SpawnPos, { schema: SpawnName, data: { name: "Ada" } }]);
    expect(world(SpawnName, eid).name).toBe("Ada");
    expect([...defineQuery([SpawnPos])(world)]).toEqual([0, 1]);

    // A delta serializer sees the bulk-added entities exactly as one-by-one ones.
    const deltaAfter = (spawn: (world: World) => void) => {
      const tracked = Chunk.create();
      const delta = createDeltaSerializer(tracked);
      delta.serialize();
      spawn(tracked);
      return [...new Uint8Array(delta.serialize())];
    };
    const bulk = deltaAfter((w) => addEntities(w, 2, [{ schema: SpawnPos, data: { x: 4 } }]));
    expect(bulk).toEqual(deltaAfter((w) => oneByOne(w, 2, [{ schema: SpawnPos, data: { x: 4 } }])));
    expect(bulk.length).toBeGreaterThan(deltaAfter(() => {}).length);

    let error: any;
    try {
      addEntities(Chunk.create(), 3, [{ schema: SpawnPos, data: { x: "far" } }]);
    } catch (e) {
      error = e;
    }
    expect(error?.error?.message).toMatch(/Invalid schema for component SpawnPos/);
  });

  test("throws before adding anything when the world is too small", () => {
    const world = Chunk.create(4);
    expect(() => addEntities(world, 5, COMPONENTS)).toThrow(/no room for 5/);
    expect(world.entityCursor).toBe(0);
    expect(addEntities(world, 4, COMPONENTS)).toEqual([0, 1, 2, 3]);
  });

  test("a hook that defines a query mid-batch: the rest of the batch joins it", () => {
    const world = Chunk.create();
    let late: ReturnType<typeof defineQuery> | undefined;
    const eids = addEntities(world, 5, COMPONENTS, { each: (_eid, i) => void (i === 1 && (late = defineQuery([SpawnTag, SpawnPos]))) });
    expect([...late!(world)].sort()).toEqual(eids);
  });
});

describe("compiled spawnMany", () => {
  const spawner = compileEntityDefinition({ name: "spawn-npc", components: [{ type: "SpawnPos" }, { type: "SpawnLife", role: 2 }, { type: "SpawnTag" }] });

  test("equals spawn() in a loop, with object overrides", () => {
    const a = Chunk.create();
    const b = Chunk.create();
    const ctx = { overrides: { SpawnLife: { home: 12 } } };
    const one = Array.from({ length: 10 }, () => spawner.spawn(a, ctx));
    const many = spawner.spawnMany(b, 10, ctx);
    expect(state(b, many)).toEqual(state(a, one));
    expect(b(SpawnLife, many[9]).home).toBe(12);
  });

  test("function overrides and dynamic values spawn one by one, with the same result", () => {
    const world = Chunk.create();
    const seen: number[] = [];
    const eids = spawner.spawnMany(world, 3, { overrides: { SpawnLife: (d) => ({ home: (d.role as number) + 1 }) } }, (eid) => seen.push(eid));
    expect(eids.map((eid) => world(SpawnLife, eid).home)).toEqual([3, 3, 3]);
    expect(seen).toEqual(eids);
    const random = compileEntityDefinition({ name: "spawn-rand", components: [{ type: "SpawnPos", x: "rand:2:4" }] });
    expect(random.spawnMany(world, 2, { rand: { number: () => 0.5 } as any }).map((eid) => world(SpawnPos, eid).x)).toEqual([3, 3]);
  });
});
