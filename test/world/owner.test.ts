import { Component, defaultValue, DrawSystemImpl, Schema, System, type } from "minecs";
import { describe, expect, test } from "vitest";
import { compileEntityDefinition } from "yage/entity/definitions";
import { createLeanGameModel } from "yage/game/LeanGameModel";
import { findOwnerWith, OwnedBy, ownedBy, ownerOf } from "yage/world/owner";

@Component("OwnerTestCamera")
class Camera extends Schema {
  @type("number") @defaultValue(1) zoom: number;
}
@Component("OwnerTestPanel")
class Panel extends Schema {
  @type("number") @defaultValue(0) kind: number;
}

const camera = compileEntityDefinition({ name: "test:camera", components: [{ type: "OwnerTestCamera", zoom: 4 }] });
const panel = compileEntityDefinition({ name: "test:panel", components: [{ type: "OwnerTestPanel" }] });
const make = () => createLeanGameModel({ world: { components: [Camera, Panel, OwnedBy] } });

describe("owners", () => {
  test("spawn with an owner; reach the owner's data through the entity", () => {
    const model = make();
    const cam = camera.spawn(model);
    const hud = panel.spawn(model, { owner: cam });
    const marker = panel.spawn(model, { owner: hud });
    expect(ownerOf(model, hud)).toBe(cam);
    expect(ownedBy(model, hud, Camera).zoom).toBe(4);
    // Up the chain: the marker belongs to a panel that belongs to the camera.
    expect(findOwnerWith(model, marker, Camera)).toBe(cam);
    expect(ownedBy(model, marker, Panel)).toBe(model(Panel, hud));
    model.destroy();
  });

  test("no owner: -1, and ownedBy throws", () => {
    const model = make();
    const lone = panel.spawn(model);
    expect(ownerOf(model, lone)).toBe(-1);
    expect(model.hasComponent(OwnedBy, lone)).toBe(false);
    expect(() => ownedBy(model, lone, Camera)).toThrow("no owner of entity");
    model.destroy();
  });

  test("apply and spawnMany take the owner too", () => {
    const model = make();
    const cam = camera.spawn(model);
    const eid = model.addEntity();
    panel.apply(model, eid, { owner: cam });
    const many = panel.spawnMany(model, 3, { owner: cam });
    for (const e of [eid, ...many]) expect(ownerOf(model, e)).toBe(cam);
    model.destroy();
  });

  test("the owner is set before the definition's components, so their systems' init can reach it", () => {
    const seen: number[] = [];
    @System(Panel)
    class PanelInit extends DrawSystemImpl {
      init(world: any, eid: number) {
        seen.push(ownedBy(world, eid, Camera).zoom);
      }
    }
    const model = createLeanGameModel({ world: { components: [Camera, Panel, OwnedBy], systems: [PanelInit] } });
    const cam = camera.spawn(model);
    panel.spawn(model, { owner: cam });
    panel.apply(model, model.addEntity(), { owner: cam });
    expect(seen).toEqual([4, 4]);
    model.destroy();
  });
});
