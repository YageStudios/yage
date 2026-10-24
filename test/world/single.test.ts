import { addComponent, addEntity, Component, defaultValue, removeEntity, Schema, type } from "minecs";
import { describe, expect, test } from "vitest";
import { createLeanGameModel } from "yage/game/LeanGameModel";
import { leanWorldType } from "yage/world/lean";
import { entitiesWith, findSingleEntity, single, singleEntity } from "yage/world/single";

@Component("SingleTestCamera")
class Camera extends Schema {
  @type("number") @defaultValue(1) zoom: number;
}
@Component("SingleTestPanel")
class Panel extends Schema {
  @type("number") @defaultValue(0) kind: number;
}

const Kind = leanWorldType({ components: [Camera, Panel] });

describe("single entities", () => {
  test("finds the one entity holding a schema, and its data", () => {
    const world = Kind.create();
    addComponent(world, Panel, addEntity(world));
    const camera = addEntity(world);
    addComponent(world, Camera, camera, { zoom: 3 });
    expect(singleEntity(world, Camera)).toBe(camera);
    expect(single(world, Camera).zoom).toBe(3);
    expect(findSingleEntity(world, Camera)).toBe(camera);
  });

  test("several schemas: the one entity holding all of them", () => {
    const world = Kind.create();
    const a = addEntity(world);
    addComponent(world, Panel, a);
    const b = addEntity(world);
    addComponent(world, Panel, b);
    addComponent(world, Camera, b);
    expect(singleEntity(world, [Camera, Panel])).toBe(b);
    expect([...entitiesWith(world, Panel)]).toEqual([a, b]);
  });

  test("none or several throw; findSingleEntity is -1 for none", () => {
    const world = Kind.create();
    expect(findSingleEntity(world, Camera)).toBe(-1);
    expect(() => singleEntity(world, Camera)).toThrow("no entity holds SingleTestCamera");
    addComponent(world, Panel, addEntity(world));
    addComponent(world, Panel, addEntity(world));
    expect(() => singleEntity(world, Panel)).toThrow("2 entities hold SingleTestPanel, expected one");
  });

  test("follows entities as they come and go", () => {
    const world = Kind.create();
    const first = addEntity(world);
    addComponent(world, Camera, first);
    removeEntity(world, first);
    const second = addEntity(world);
    addComponent(world, Camera, second, { zoom: 5 });
    expect(single(world, Camera).zoom).toBe(5);
  });

  test("LeanGameModel exposes single and singleEntity", () => {
    const model = createLeanGameModel({ world: { components: [Camera, Panel] } });
    const eid = model.addEntity();
    model.addComponent(Camera, eid, { zoom: 2 });
    expect(model.singleEntity(Camera)).toBe(eid);
    expect(model.single(Camera).zoom).toBe(2);
    model.destroy();
  });
});
