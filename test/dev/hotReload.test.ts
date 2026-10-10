import { addComponent, addEntity, createWorld, DrawSystemImpl, SystemImpl } from "minecs";
import { afterEach, describe, expect, test } from "vitest";
import Description from "yage/schemas/core/Description";
import { EntityType } from "yage/schemas/entity/Types";
import { GameModel } from "yage/game/GameModel";
import { InputManager } from "yage/inputs/InputManager";
import { PlayerEventManager } from "yage/inputs/PlayerEventManager";
import {
  applyHotReload,
  beginHotSystems,
  finishHotSystems,
  hotSystem,
  stageEntityDefinition,
  setEntityReloadHandler,
} from "yage/dev/hotReload";

const addDescribedEntity = (world: ReturnType<typeof createWorld>) => {
  const entity = addEntity(world);
  addComponent(world, Description, entity, { description: "hot reload target" });
  return entity;
};

afterEach(() => setEntityReloadHandler(() => {}));

describe("hot system runtime", () => {
  test("keeps constructor and live instance references stable while swapping behavior at apply time", () => {
    const file = "hot-reload-stable-reference.ts";
    const makeSystem = (label: string) => {
      class StableReferenceSystem extends SystemImpl {
        static buildLabel = label;
        count = 0;
        getLabel() { return label; }
        run() { this.count++; }
      }
      return StableReferenceSystem;
    };

    beginHotSystems(file);
    const stableConstructor = hotSystem(file, Description)(makeSystem("before"));
    const world = createWorld();
    addDescribedEntity(world);
    const instance = world.systems.find(system => system.constructor.name === "StableReferenceSystem")!;
    expect(instance.constructor).toBe(stableConstructor);

    instance.runAll(world);
    expect((instance as any).count).toBe(1);
    beginHotSystems(file);
    expect(hotSystem(file, Description)(makeSystem("after"))).toBe(stableConstructor);
    expect(finishHotSystems(file, true)).toBe(true);

    expect((instance as any).getLabel()).toBe("before");
    expect((stableConstructor as any).buildLabel).toBe("before");
    applyHotReload(world);
    expect(world.systems.find(system => system.constructor.name === "StableReferenceSystem")).toBe(instance);
    expect(instance.constructor).toBe(stableConstructor);
    expect((instance as any).getLabel()).toBe("after");
    expect((stableConstructor as any).buildLabel).toBe("after");
    expect((instance as any).count).toBe(1);
    instance.runAll(world);
    expect((instance as any).count).toBe(2);
  });

  test("stages entity definitions at the next explicit world boundary and keeps the newest definition", () => {
    const received: unknown[] = [];
    setEntityReloadHandler(definition => received.push(definition));
    const world = createWorld();
    const file = "hot-reload-entity-queue.json";
    const invalidate = () => {};
    const initial = { name: "Target", components: [{ type: "initial" }] };
    const first = { name: "Target", components: [{ type: "first" }] };
    const latest = { name: "Target", components: [{ type: "latest" }] };

    expect(stageEntityDefinition(file, initial, invalidate)).toBe(true);
    expect(stageEntityDefinition(file, first, invalidate)).toBe(true);
    expect(stageEntityDefinition(file, latest, invalidate)).toBe(true);
    expect(stageEntityDefinition(file, { name: "Renamed" }, invalidate)).toBe(false);
    expect(received).toEqual([]);
    applyHotReload(world);
    expect(received).toEqual([latest]);
    applyHotReload(world);
    expect(received).toEqual([latest]);
  });

  test("invalidates the entity module when applying its definition fails", () => {
    const invalidations: string[] = [];
    setEntityReloadHandler(() => { throw new Error("definition cannot be applied"); });
    const file = "hot-reload-entity-error.json";
    expect(stageEntityDefinition(file, { name: "Target" }, () => {})).toBe(true);
    expect(stageEntityDefinition(file, { name: "Target" }, reason => invalidations.push(reason))).toBe(true);

    applyHotReload(createWorld());
    expect(invalidations).toEqual(["definition cannot be applied"]);
  });

  test("rejects a removed system from a self-accepted module", () => {
    const file = "hot-reload-schema-fallback.ts";
    const registerSystem = (name: "FirstSystem" | "SecondSystem") => {
      if (name === "FirstSystem") {
        class FirstSystem extends SystemImpl {}
        return hotSystem(file, Description)(FirstSystem);
      }
      class SecondSystem extends SystemImpl {}
      return hotSystem(file, Description)(SecondSystem);
    };

    beginHotSystems(file);
    registerSystem("FirstSystem");
    registerSystem("SecondSystem");
    expect(finishHotSystems(file, false)).toBe(true);
    beginHotSystems(file);
    expect(finishHotSystems(file, true)).toBe(false);
  });

  test("updates GameModel query lookups and scheduling at the next simulation step", () => {
    const file = "hot-reload-query-and-schedule.ts";
    const calls: string[] = [];
    const makeSystem = (version: string, schema: typeof Description | typeof EntityType, frameMod: number) => {
      class QueryScheduleSystem extends SystemImpl {
        static frameMod = frameMod;
        static category = version === "new" ? 7 : 2;
        static depth = version === "new" ? 4 : 0;
        count = 0;
        init(_world: any, entity: number) { calls.push(`${version}:init:${entity}`); }
        cleanup(_world: any, entity: number) { calls.push(`${version}:cleanup:${entity}`); }
        run(_world: any, entity: number) { this.count++; calls.push(`${version}:run:${entity}`); }
      }
      return hotSystem(file, schema)(QueryScheduleSystem);
    };

    beginHotSystems(file);
    makeSystem("old", Description, 1);
    const world = createWorld();
    const gameModel = GameModel({
      seed: "hot-reload",
      roomId: "hot-reload",
      world,
      inputManager: new InputManager(),
      playerEventManager: new PlayerEventManager(),
    });
    const oldEntity = addDescribedEntity(world);
    const nextEntity = addEntity(world);
    addComponent(world, EntityType, nextEntity);
    gameModel.step();
    const systemConstructor = world.systems.find(system => system.constructor.name === "QueryScheduleSystem")!.constructor as any;
    const instance = gameModel.getSystem(systemConstructor);
    expect((instance as any).count).toBe(1);
    expect(gameModel.getSystemsByType(Description.type).flat()).toContain(instance);

    beginHotSystems(file);
    makeSystem("new", EntityType, 2);
    expect(finishHotSystems(file, true)).toBe(true);
    expect((instance.constructor as any).frameMod).toBe(1);
    expect((instance.constructor as any).category).toBe(2);
    expect((instance.constructor as any).depth).toBe(0);
    gameModel.step();
    expect(applyHotReload(world)).toBe(false);
    expect([...instance.query(world)]).toEqual([nextEntity]);
    expect(world.systemQueryMap.get(EntityType.type)).toContain(instance);
    expect(world.systemQueryMap.get(Description.type)?.includes(instance)).toBe(false);
    expect(calls).toContain(`old:cleanup:${oldEntity}`);
    expect(calls).toContain(`new:init:${nextEntity}`);
    expect(gameModel.getSystem(systemConstructor)).toBe(instance);
    expect(gameModel.getSystemsByType(Description.type).flat()).not.toContain(instance);
    expect(gameModel.getSystemsByType(EntityType.type).flat()).toContain(instance);

    gameModel.step();
    expect(calls.at(-1)).toBe(`new:run:${nextEntity}`);
    gameModel.step();
    expect(calls.at(-1)).toBe(`new:run:${nextEntity}`);
    expect((instance as any).count).toBe(2);
    expect((instance.constructor as any).category).toBe(7);
    expect((instance.constructor as any).depth).toBe(4);
  });

  test("cleans up old draw state and initializes the replacement for matching entities", () => {
    const file = "hot-reload-draw-cleanup.ts";
    const calls: string[] = [];
    const makeDrawSystem = (version: string) => {
      class ReloadableDrawSystem extends DrawSystemImpl {
        init(_world: any, entity: number) { calls.push(`${version}:init:${entity}`); }
        cleanup(_world: any, entity: number) { calls.push(`${version}:cleanup:${entity}`); }
        run() { calls.push(`${version}:run`); }
      }
      return ReloadableDrawSystem;
    };
    beginHotSystems(file);
    hotSystem(file, Description)(makeDrawSystem("old"));
    const world = createWorld();
    const entity = addDescribedEntity(world);
    const instance = world.drawSystems.find(system => system.constructor.name === "ReloadableDrawSystem")!;
    beginHotSystems(file);
    hotSystem(file, Description)(makeDrawSystem("new"));
    expect(finishHotSystems(file, true)).toBe(true);

    applyHotReload(world);
    expect(world.drawSystems[0]).toBe(instance);
    expect(calls.slice(-2)).toEqual([`old:cleanup:${entity}`, `new:init:${entity}`]);
    (instance as any).run(world, entity);
    expect(calls.at(-1)).toBe("new:run");
  });

  test("applies one update independently to instances in multiple worlds", () => {
    const file = "hot-reload-multiple-worlds.ts";
    const makeSystem = (value: string) => {
      class MultipleWorldSystem extends SystemImpl {
        getValue() { return value; }
      }
      return MultipleWorldSystem;
    };
    beginHotSystems(file);
    hotSystem(file, Description)(makeSystem("old"));
    const firstWorld = createWorld();
    const secondWorld = createWorld();
    addDescribedEntity(firstWorld);
    addDescribedEntity(secondWorld);
    const firstInstance = firstWorld.systems.find(system => system.constructor.name === "MultipleWorldSystem")!;
    const secondInstance = secondWorld.systems.find(system => system.constructor.name === "MultipleWorldSystem")!;

    beginHotSystems(file);
    hotSystem(file, Description)(makeSystem("new"));
    expect(finishHotSystems(file, true)).toBe(true);
    applyHotReload(firstWorld);
    expect((firstInstance as any).getValue()).toBe("new");
    expect((secondInstance as any).getValue()).toBe("old");
    applyHotReload(secondWorld);
    expect((secondInstance as any).getValue()).toBe("new");

    const futureWorld = createWorld();
    addDescribedEntity(futureWorld);
    const futureInstance = futureWorld.systems.find(system => system.constructor.name === "MultipleWorldSystem")!;
    expect(futureInstance.constructor).toBe((firstInstance as any).constructor);
    expect(futureInstance).toBeInstanceOf((firstInstance as any).constructor);
    expect((futureInstance as any).getValue()).toBe("new");
  });
});
