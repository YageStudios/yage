import {
  Component,
  Schema,
  System,
  SystemImpl,
  addComponent,
  addEntity,
  defaultValue,
  defineQuery,
  removeComponent,
  removeEntity,
  serializeWorld,
  SerialMode,
  stepWorld,
  type,
  type World,
} from "minecs";
import { describe, expect, test } from "vitest";
import { leanWorldType, saveWorld, savedQueryKeys } from "yage/world/lean";

@Component("SavePos")
class SavePos extends Schema {
  @type("number") @defaultValue(0) x: number;
}
@Component("SaveVel")
class SaveVel extends Schema {
  @type("number") @defaultValue(1) v: number;
}
@Component("SaveTag")
class SaveTag extends Schema {
  @type("number") @defaultValue(0) t: number;
}

const order: number[] = [];
@System(SavePos, SaveVel)
class SaveMove extends SystemImpl<World> {
  run = (world: World, eid: number) => {
    order.push(eid);
    world(SavePos, eid).x += world(SaveVel, eid).v;
  };
}
@System(SaveTag)
class SaveTagged extends SystemImpl<World> {
  run = (_world: World, eid: number) => {
    order.push(eid);
  };
}
@System(SavePos)
class SaveSettle extends SystemImpl<World> {
  run = () => {};
}

const Base = leanWorldType({ size: 32, components: [SaveTag], systems: [SaveMove, SaveTagged] });
const Wider = leanWorldType({ size: 32, systems: [SaveSettle, SaveTagged, SaveMove] });

/** Movers 0..5, with tags on the even ones. */
const fill = (world: World) => {
  for (let i = 0; i < 6; i++) {
    const eid = addEntity(world);
    addComponent(world, SavePos, eid, { x: i });
    addComponent(world, SaveVel, eid, { v: 1 });
    if (i % 2 === 0) addComponent(world, SaveTag, eid);
  }
  return world;
};
const bytes = (payload: ArrayBuffer) => new Uint8Array(payload);
const runOrder = (world: World) => {
  order.length = 0;
  stepWorld(world);
  return [...order];
};

describe("canonical world saves", () => {
  test("a query a rebuild reproduces is left out, so adding or reordering systems keeps the bytes", () => {
    const a = fill(Base.create());
    const b = fill(Wider.create());
    expect(savedQueryKeys(a)).toEqual([]);
    expect(bytes(saveWorld(SerialMode.BINARY, a))).toEqual(bytes(saveWorld(SerialMode.BINARY, b)));
    // minecs' own serializer writes every query in creation order, so the two differ.
    expect(bytes(serializeWorld(SerialMode.BINARY, a))).not.toEqual(bytes(serializeWorld(SerialMode.BINARY, b)));
  });

  test("a query out of entity order is written, sorted by key, and loads back in its order", () => {
    const world = fill(Base.create());
    // Re-adding SaveVel to entity 1 moves it to the end of the mover query but not of the entities.
    removeComponent(world, SaveVel, 1);
    runOrder(world);
    addComponent(world, SaveVel, 1, { v: 1 });
    const before = runOrder(world);
    expect(savedQueryKeys(world)).toEqual(["SavePos|SaveVel"]);

    const payload = saveWorld(SerialMode.BINARY, world);
    const copy = Base.deserialize(payload);
    expect(runOrder(copy)).toEqual(runOrder(world));
    expect(before.slice(0, 5)).toEqual([0, 5, 2, 3, 4]);
    expect(bytes(saveWorld(SerialMode.BINARY, copy))).toEqual(bytes(saveWorld(SerialMode.BINARY, world)));
  });

  test("pending removals are written so the load commits them as the live world would", () => {
    const world = fill(Base.create());
    removeEntity(world, 2);
    expect(savedQueryKeys(world)).toContain("SavePos|SaveVel");
    const copy = Base.deserialize(saveWorld(SerialMode.BINARY, world));
    expect(runOrder(copy)).toEqual(runOrder(world));
  });

  test("a query no system holds is always written", () => {
    const world = fill(Base.create());
    defineQuery([SaveTag, SavePos])(world);
    expect(savedQueryKeys(world)).toEqual(["SavePos|SaveTag"]);
    const copy = Base.deserialize(saveWorld(SerialMode.BINARY, world));
    expect([...defineQuery([SaveTag, SavePos])(copy)]).toEqual([...defineQuery([SaveTag, SavePos])(world)]);
  });

  test("full-table saves from minecs' serializer still load to the same world", () => {
    for (const mode of [SerialMode.BINARY, SerialMode.JSON] as const) {
      const world = fill(Base.create());
      removeComponent(world, SaveVel, 1);
      runOrder(world);
      addComponent(world, SaveVel, 1, { v: 1 });
      const copy = Base.deserialize(serializeWorld(mode as SerialMode.BINARY, world));
      expect(runOrder(copy)).toEqual(runOrder(world));
      expect(bytes(saveWorld(SerialMode.BINARY, copy))).toEqual(bytes(saveWorld(SerialMode.BINARY, world)));
    }
  });

  test("JSON and base64 saves use the same table and leave the live query map alone", () => {
    const world = fill(Base.create());
    const live = [...(world as any).queryMap.keys()];
    expect(Object.keys(saveWorld(SerialMode.JSON, world).queryMap)).toEqual([]);
    expect(typeof saveWorld(SerialMode.BASE64, world)).toBe("string");
    expect([...(world as any).queryMap.keys()]).toEqual(live);
    const copy = Base.deserialize(saveWorld(SerialMode.JSON, world));
    expect(runOrder(copy)).toEqual(runOrder(world));
  });
});
