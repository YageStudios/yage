import { addComponent, addEntity, createWorld, hasComponent, removeEntity } from "minecs";
import { describe, expect, test } from "vitest";
import { Transform } from "yage/schemas/entity/Transform";
import { Parent } from "yage/schemas/entity/Parent";
import { Radius } from "yage/schemas/entity/Radius";
import type { EntityFactory, EntityDefinition } from "yage/entity/EntityFactory";
import { applyEntityDefaults, forgetEntityTemplate, trackEntityTemplate } from "yage/entity/hotDefaults";
import { applyHotReload, queueEntityDefaultsPatch, registerHotWorld } from "yage/dev/hotReload";

const factory = (name: string, components: EntityDefinition["components"]) => {
  const definition = { name, components: components ?? [] };
  return {
    entityDefinitionMap: new Map([[name.toLowerCase(), definition]]),
    generateComponents: (entity: EntityDefinition) => ({ components: entity.components ?? [] }),
  } as unknown as EntityFactory;
};

describe("hot entity defaults", () => {
  test("updates unchanged defaults while preserving gameplay overrides and array values", () => {
    const world = createWorld();
    const entity = addEntity(world);
    addComponent(world, Transform, entity, { x: 1, y: 2 });
    addComponent(world, Parent, entity, { children: [4, 8] });
    world(Transform, entity).y = 19;
    trackEntityTemplate(world, entity, "Tree");
    const overriddenArrayEntity = addEntity(world);
    addComponent(world, Transform, overriddenArrayEntity, { x: 1, y: 2 });
    addComponent(world, Parent, overriddenArrayEntity, { children: [4, 8] });
    world(Parent, overriddenArrayEntity).children[1] = 91;
    trackEntityTemplate(world, overriddenArrayEntity, "Tree");

    const previous = factory("Tree", [
      { type: "Transform", data: { x: 1, y: 2 } },
      { type: "Parent", data: { children: [4, 8] } },
    ]);
    const next = factory("Tree", [
      { type: "Transform", data: { x: 3, y: 5 } },
      { type: "Parent", data: { children: [9, 10] } },
    ]);

    applyEntityDefaults(world, previous, next);

    expect(world(Transform, entity).x).toBe(3);
    expect(world(Transform, entity).y).toBe(19);
    expect(world(Transform, entity).z).toBe(0);
    expect([...world(Parent, entity).children]).toEqual([9, 10]);
    expect([...world(Parent, overriddenArrayEntity).children]).toEqual([4, 91]);
  });

  test("does not add components or apply defaults to worlds created after the patch", () => {
    const previous = factory("Tree", [{ type: "Transform", data: { x: 1 } }]);
    const next = factory("Tree", [{ type: "Transform", data: { x: 6 } }]);
    const existingWorld = createWorld();
    registerHotWorld(existingWorld);
    const existingEntity = addEntity(existingWorld);
    addComponent(existingWorld, Transform, existingEntity, { x: 1 });
    trackEntityTemplate(existingWorld, existingEntity, "Tree");
    queueEntityDefaultsPatch(world => applyEntityDefaults(world, previous, next));

    const futureWorld = createWorld();
    registerHotWorld(futureWorld);
    const futureEntity = addEntity(futureWorld);
    addComponent(futureWorld, Parent, futureEntity, { children: [2] });
    trackEntityTemplate(futureWorld, futureEntity, "Tree");

    applyHotReload(existingWorld);
    applyHotReload(futureWorld);
    expect(existingWorld(Transform, existingEntity).x).toBe(6);
    expect(hasComponent(futureWorld, Transform, futureEntity)).toBe(false);
  });

  test("ignores removed entities, unknown templates, disabled components, and invalid expressions", () => {
    const world = createWorld();
    const deleted = addEntity(world);
    addComponent(world, Transform, deleted, { x: 1 });
    trackEntityTemplate(world, deleted, "Tree");
    removeEntity(world, deleted);

    const invalid = addEntity(world);
    addComponent(world, Transform, invalid, { x: 1 });
    trackEntityTemplate(world, invalid, "Invalid");
    const missing = addEntity(world);
    trackEntityTemplate(world, missing, "Missing");
    const withoutComponent = addEntity(world);
    trackEntityTemplate(world, withoutComponent, "NoComponent");

    const previous = factory("Invalid", [{ type: "Transform", data: { x: 1 } }]);
    const next = factory("Invalid", [
      { type: "Transform", enabled: false, data: { x: 2 } },
      { type: "Transform", data: { x: "rand:0:4" as unknown as number } },
    ]);
    applyEntityDefaults(world, previous, next);

    expect(world(Transform, invalid).x).toBe(1);
    applyEntityDefaults(
      world,
      factory("NoComponent", [{ type: "Transform", data: { x: 1 } }]),
      factory("NoComponent", [{ type: "Transform", data: { x: 2 } }])
    );
    applyEntityDefaults(world, previous, previous);
    applyEntityDefaults(createWorld(), previous, next);
    expect(hasComponent(world, Transform, withoutComponent)).toBe(false);
  });

  test("ignores fields that were not present in the old definition", () => {
    const world = createWorld();
    const entity = addEntity(world);
    addComponent(world, Transform, entity, { x: 1, y: 13 });
    trackEntityTemplate(world, entity, "Tree");

    const previous = factory("Tree", [{ type: "Transform", data: { x: 1 } }]);
    const next = factory("Tree", [{ type: "Transform", data: { x: 7, y: 3 } }]);
    applyEntityDefaults(world, previous, next);

    expect(world(Transform, entity).x).toBe(7);
    expect(world(Transform, entity).y).toBe(13);
  });

  test("ignores newly authored fields without old defaults and forgotten entity templates", () => {
    const world = createWorld();
    const entity = addEntity(world);
    addComponent(world, Radius, entity, { radius: 12 });
    trackEntityTemplate(world, entity, "RadiusOnly");
    const forgotten = addEntity(world);
    addComponent(world, Transform, forgotten, { x: 1 });
    trackEntityTemplate(world, forgotten, "Tree");
    forgetEntityTemplate(world, forgotten);

    applyEntityDefaults(
      world,
      factory("RadiusOnly", [{ type: "Radius" }]),
      factory("RadiusOnly", [{ type: "Radius", data: { radius: 3 } }])
    );
    applyEntityDefaults(
      world,
      factory("Tree", [{ type: "Transform", data: { x: 1 } }]),
      factory("Tree", [{ type: "Transform", data: { x: 9 } }])
    );

    expect(world(Radius, entity).radius).toBe(12);
    expect(world(Transform, forgotten).x).toBe(1);
  });

  test("uses the raw component object when its data field is absent", () => {
    const world = createWorld();
    const entity = addEntity(world);
    addComponent(world, Transform, entity, { x: 1 });
    trackEntityTemplate(world, entity, "Tree");
    const previous = factory("Tree", [{ type: "Transform", x: 1 } as any]);
    const next = factory("Tree", [{ type: "Transform", x: 4 } as any]);

    applyEntityDefaults(world, previous, next);

    expect(world(Transform, entity).x).toBe(4);
  });
});
