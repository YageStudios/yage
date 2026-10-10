import test from "node:test";
import assert from "node:assert/strict";
import { addComponent, addEntity, createWorld, DrawSystemImpl, SystemImpl, Schema, Component, defaultValue, type } from "minecs";
import { createRequire } from "node:module";
import { join } from "node:path";

const require = createRequire(import.meta.url);
const build = process.env.YAGE_HOT_RELOAD_BUILD;
const { applyEntityDefaults, forgetEntityTemplate, trackEntityTemplate } = require(join(build, "hotDefaults.js"));
const hotReload = await import(new URL(`file://${join(build, "hotReload.js")}`));

class Position extends Schema {}
defaultValue(0)(Position.prototype, "x");
type("float32")(Position.prototype, "x");
defaultValue(0)(Position.prototype, "y");
type("float32")(Position.prototype, "y");
Component()(Position);

class Values extends Schema {}
defaultValue([])(Values.prototype, "items");
type("EntityArray")(Values.prototype, "items");
Component()(Values);

class Marker extends Schema {}
type("number")(Marker.prototype, "value");
Component()(Marker);

const factory = (name, components) => ({
  entityDefinitionMap: new Map(name ? [[name.toLowerCase(), { name, components }]] : []),
  generateComponents: definition => ({ components: definition.components ?? [] }),
});

test("entity defaults patch authored values, preserve overrides, and skip unsupported cases", () => {
  const world = createWorld();
  const entity = addEntity(world);
  addComponent(world, Position, entity, { x: 1, y: 2 });
  trackEntityTemplate(world, entity, "Tree");
  const arrayEntity = addEntity(world);
  addComponent(world, Values, arrayEntity, { items: [2, 4] });
  trackEntityTemplate(world, arrayEntity, "Tree");
  world(Position, entity).y = 20;
  world(Values, arrayEntity).items[1] = 40;

  applyEntityDefaults(world,
    factory("Tree", [
      { type: "Position", data: { x: 1, y: 2 } },
      { type: "Values", data: { items: [2, 4] } },
    ]),
    factory("Tree", [
      { type: "Position", data: { x: 3, y: 5 } },
      { type: "Values", data: { items: [6, 8] } },
    ])
  );
  assert.equal(world(Position, entity).x, 3);
  assert.equal(world(Position, entity).y, 20);
  assert.deepEqual([...world(Values, arrayEntity).items], [2, 40]);

  const deleted = addEntity(world);
  trackEntityTemplate(world, deleted, "Tree");
  const absentComponent = addEntity(world);
  trackEntityTemplate(world, absentComponent, "NoComponent");
  const invalid = addEntity(world);
  addComponent(world, Position, invalid, { x: 1 });
  trackEntityTemplate(world, invalid, "Invalid");
  const marker = addEntity(world);
  addComponent(world, Marker, marker, { value: 2 });
  trackEntityTemplate(world, marker, "Marker");
  const missingOldField = addEntity(world);
  addComponent(world, Marker, missingOldField, { value: 2 });
  trackEntityTemplate(world, missingOldField, "NoOldField");
  const forgotten = addEntity(world);
  addComponent(world, Position, forgotten, { x: 1 });
  trackEntityTemplate(world, forgotten, "Tree");
  forgetEntityTemplate(world, forgotten);

  const prior = factory("Invalid", [{ type: "Position", data: { x: 1 } }]);
  const invalidNext = factory("Invalid", [
    { type: "Position", enabled: false, data: { x: 3 } },
    { type: "Position", data: { x: "rand:1:5" } },
  ]);
  applyEntityDefaults(world, prior, invalidNext);
  applyEntityDefaults(world,
    factory("NoComponent", [{ type: "Position", data: { x: 1 } }]),
    factory("NoComponent", [{ type: "Position", data: { x: 4 } }])
  );
  applyEntityDefaults(world,
    factory("Marker", [{ type: "Marker", value: 2 }]),
    factory("Marker", [{ type: "Marker", value: 8 }])
  );
  applyEntityDefaults(world,
    factory("NoOldField", [{ type: "Marker" }]),
    factory("NoOldField", [{ type: "Marker", data: { value: 9 } }])
  );
  applyEntityDefaults(createWorld(), prior, invalidNext);
  assert.equal(world(Position, invalid).x, 1);
  assert.equal(world(Marker, marker).value, 8);
  assert.equal(world(Marker, missingOldField).value, 2);
  assert.equal(world(Position, forgotten).x, 1);
});

test("queued entity patches apply once to registered worlds and not to later worlds", () => {
  const previous = factory("Tree", [{ type: "Position", data: { x: 1 } }]);
  const next = factory("Tree", [{ type: "Position", data: { x: 7 } }]);
  const existing = createWorld();
  hotReload.registerHotWorld(existing);
  const firstEntity = addEntity(existing);
  addComponent(existing, Position, firstEntity, { x: 1 });
  trackEntityTemplate(existing, firstEntity, "Tree");
  hotReload.queueEntityDefaultsPatch(world => applyEntityDefaults(world, previous, next));

  const future = createWorld();
  hotReload.registerHotWorld(future);
  const futureEntity = addEntity(future);
  addComponent(future, Position, futureEntity, { x: 1 });
  trackEntityTemplate(future, futureEntity, "Tree");

  assert.equal(hotReload.isEntityHotReloadEnabled(), false);
  assert.equal(hotReload.applyHotReload(existing), false);
  assert.equal(existing(Position, firstEntity).x, 7);
  hotReload.applyHotReload(future);
  assert.equal(future(Position, futureEntity).x, 1);
});

test("hot systems commit edits at a world boundary and preserve stable identity, state, and metadata", () => {
  const file = "coverage-runtime.ts";
  const makeSystem = version => {
    class CoverageSystem extends SystemImpl {
      static customSetting = version;
      static frameMod = version === "new" ? 2 : 1;
      count = 0;
      label() { return version; }
      run() { this.count++; }
    }
    return CoverageSystem;
  };
  hotReload.beginHotSystems(file);
  const StableSystem = hotReload.hotSystem(file, Position)(makeSystem("old"));
  assert.equal(hotReload.finishHotSystems(file, false), true);
  const world = createWorld();
  const entity = addEntity(world);
  addComponent(world, Position, entity, { x: 1 });
  const system = world.systems.find(candidate => candidate.constructor.name === "CoverageSystem");
  assert.equal(hotReload.hasHotSystems(world), true);
  assert.equal(hotReload.getHotSystem(world, StableSystem), system);
  assert.equal(hotReload.getHotSystem(world, SystemImpl), undefined);
  system.runAll(world);
  assert.equal(system.count, 1);

  hotReload.beginHotSystems(file);
  assert.equal(hotReload.hotSystem(file, Position)(makeSystem("new")), StableSystem);
  assert.equal(hotReload.finishHotSystems(file, true), true);
  assert.equal(StableSystem.customSetting, "old");
  assert.equal(hotReload.applyHotReload(world), true);
  assert.equal(system.label(), "new");
  assert.equal(system.count, 1);
  assert.equal(StableSystem.customSetting, "new");
  assert.equal(system.constructor, StableSystem);
  assert.equal(system instanceof StableSystem, true);
  hotReload.stepHotWorld(world, true);
  assert.equal(system.count, 2);
  assert.equal(world.timing.systems[0].name, "CoverageSystem");
  hotReload.stepHotWorld(world, true);
  assert.equal(system.count, 2);
  assert.equal(hotReload.applyHotReload(world), false);
});

test("draw systems clean old state and initialize the new query membership", () => {
  const file = "coverage-draw.ts";
  const events = [];
  const makeDraw = label => {
    class CoverageDraw extends DrawSystemImpl {
      init(_world, entity) { events.push(`${label}:init:${entity}`); }
      cleanup(_world, entity) { events.push(`${label}:cleanup:${entity}`); }
    }
    return CoverageDraw;
  };
  hotReload.beginHotSystems(file);
  hotReload.hotSystem(file, Position)(makeDraw("old"));
  const world = createWorld();
  const entity = addEntity(world);
  addComponent(world, Position, entity, { x: 1 });
  const draw = world.drawSystems[0];
  hotReload.beginHotSystems(file);
  hotReload.hotSystem(file, Position)(makeDraw("new"));
  assert.equal(hotReload.finishHotSystems(file, true), true);
  assert.equal(hotReload.applyHotReload(world), true);
  assert.deepEqual(events.slice(-2), [`old:cleanup:${entity}`, `new:init:${entity}`]);
  assert.equal(world.drawSystems[0], draw);
});

test("structural system and entity changes request full reload handling", () => {
  const file = "coverage-structural.ts";
  hotReload.beginHotSystems(file);
  class ExistingSystem extends SystemImpl {}
  hotReload.hotSystem(file, Position)(ExistingSystem);
  assert.equal(hotReload.finishHotSystems(file, false), true);
  hotReload.beginHotSystems(file);
  assert.equal(hotReload.finishHotSystems(file, true), false);

  const received = [];
  hotReload.setEntityReloadHandler(value => received.push(value));
  const entityFile = "coverage-entity.json";
  assert.equal(hotReload.stageEntityDefinition(entityFile, null, () => {}), false);
  assert.equal(hotReload.stageEntityDefinition(entityFile, { name: "Tree" }, () => {}), true);
  assert.equal(hotReload.stageEntityDefinition(entityFile, { name: "Tree", value: 1 }, () => {}), true);
  assert.equal(hotReload.stageEntityDefinition(entityFile, { name: "Renamed" }, () => {}), false);
  assert.equal(hotReload.applyHotReload(createWorld()), false);
  assert.deepEqual(received, [{ name: "Tree", value: 1 }]);

  const errors = [];
  hotReload.setEntityReloadHandler(() => { throw new Error("cannot apply"); });
  const errorFile = "coverage-entity-error.json";
  hotReload.stageEntityDefinition(errorFile, { name: "Broken" }, () => {});
  hotReload.stageEntityDefinition(errorFile, { name: "Broken" }, reason => errors.push(reason));
  assert.equal(hotReload.applyHotReload(createWorld()), false);
  assert.deepEqual(errors, ["cannot apply"]);
  hotReload.setEntityReloadHandler(() => {});
});
