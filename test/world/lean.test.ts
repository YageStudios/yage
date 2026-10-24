import {
  Component,
  Schema,
  System,
  SystemImpl,
  addComponent,
  addEntity,
  createWorld,
  defaultValue,
  defineQuery,
  getSystem,
  serializeWorld,
  SerialMode,
  stepWorld,
  type,
  type World,
} from "minecs";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { EntityDefinitionRegistry } from "yage/entity/definitions";
import { createLeanWorld, deserializeLeanWorld, isComponentRegistered, leanWorldType, systemComponents } from "yage/world/lean";

@Component("LeanPos")
class LeanPos extends Schema {
  @type("number") @defaultValue(0) x: number;
}
@Component("LeanVel")
class LeanVel extends Schema {
  @type("number") @defaultValue(1) v: number;
}
@Component("LeanTag")
class LeanTag extends Schema {
  @type("number") @defaultValue(0) t: number;
}
@Component("LeanUnused")
class LeanUnused extends Schema {
  @type("number") @defaultValue(0) u: number;
}

@System(LeanPos, LeanVel)
class LeanMove extends SystemImpl<World> {
  run = (world: World, eid: number) => {
    world(LeanPos, eid).x += world(LeanVel, eid).v;
  };
}
@System(LeanUnused)
class LeanUnusedSystem extends SystemImpl<World> {
  run = () => {};
}

describe("lean world", () => {
  test("registers the listed components plus the ones its systems query, and only its systems", () => {
    const world = createLeanWorld({ size: 8, components: [LeanTag], systems: [LeanMove] });
    expect(isComponentRegistered(world, LeanPos)).toBe(true);
    expect(isComponentRegistered(world, LeanVel)).toBe(true);
    expect(isComponentRegistered(world, LeanTag)).toBe(true);
    expect(isComponentRegistered(world, LeanUnused)).toBe(false);
    expect(world.componentMap.size).toBe(3);
    expect(world.systems.map((s) => s.constructor)).toEqual([LeanMove]);
    expect(getSystem(world, LeanUnusedSystem)).toBeUndefined();
    expect(systemComponents(LeanMove)).toEqual([LeanPos, LeanVel]);

    const eid = addEntity(world);
    addComponent(world, LeanPos, eid, { x: 1 });
    addComponent(world, LeanVel, eid, { v: 2 });
    stepWorld(world);
    expect(world(LeanPos, eid).x).toBe(3);
  });

  test("an unregistered schema is a clear error from world(schema) and defineQuery", () => {
    const world = createLeanWorld({ systems: [LeanMove] });
    expect(() => world(LeanUnused)).toThrow(/LeanUnused is not registered in this world/);
    expect(() => defineQuery([LeanUnused])(world)).toThrow(/uses component LeanUnused, which is not registered/);
  });

  test("addComponent of an unlisted component registers it on demand (minecs behaviour)", () => {
    const world = createLeanWorld({ systems: [LeanMove] });
    addComponent(world, LeanUnused, addEntity(world));
    expect(isComponentRegistered(world, LeanUnused)).toBe(true);
    expect(getSystem(world, LeanUnusedSystem)).toBeUndefined();
  });

  test("round-trips through serialize and lean deserialize", () => {
    const Chunk = leanWorldType({ size: 32, systems: [LeanMove] });
    {
      const source = Chunk.create();
      const eid = addEntity(source);
      addComponent(source, LeanPos, eid, { x: 5 });
      addComponent(source, LeanVel, eid, { v: 3 });
      for (const payload of [serializeWorld(SerialMode.BINARY, source), serializeWorld(SerialMode.JSON, source)]) {
        const copy = Chunk.deserialize(payload);
        expect(isComponentRegistered(copy, LeanUnused)).toBe(false);
        expect(copy.systems.map((s) => s.constructor)).toEqual([LeanMove]);
        stepWorld(copy);
        expect(copy(LeanPos, eid).x).toBe(8);
      }
    }
  });

  test("deserializing a payload with components the spec lacks is a clear error", () => {
    // A full world serializes every registered component, so it does not fit a lean spec.
    const bytes = serializeWorld(SerialMode.BINARY, createWorld(8));
    expect(() => deserializeLeanWorld(bytes, { systems: [LeanMove] })).toThrow(/minECS - component \w+ is not registered in this world/);
  });

  test("compiled definitions spawn into a lean world", () => {
    const registry = new EntityDefinitionRegistry([{ name: "Mover", components: [{ type: "LeanPos", data: { x: 2 } }, "LeanVel"] }]);
    const world = createLeanWorld({ systems: [LeanMove] });
    const eid = registry.compile("Mover").spawn(world);
    stepWorld(world);
    expect(world(LeanPos, eid).x).toBe(3);
  });

  test("a worker importing only the lean world, the definitions core and game schemas pulls in no engine registry", async () => {
    const entry = fileURLToPath(new URL("./fixtures/leanWorker.ts", import.meta.url));
    const result = await build({
      entryPoints: [entry],
      bundle: true,
      write: false,
      metafile: true,
      format: "esm",
      platform: "browser",
      conditions: ["yage-source"],
      logLevel: "silent",
    });
    const inputs = Object.keys(result.metafile!.inputs).map((p) => p.replaceAll("\\", "/"));
    const engine = inputs.filter((p) => p.includes("engine/")).map((p) => p.slice(p.indexOf("engine/"))).sort();
    expect(engine.every((p) => p.startsWith("engine/world/") || p.startsWith("engine/entity/definitions/") || p === "engine/constants/enums.ts")).toBe(true);
    expect(engine).toContain("engine/world/lean.ts");
    const packages = new Set(inputs.filter((p) => p.includes("node_modules/")).map((p) => p.split("node_modules/").pop()!.split("/")[0]));
    for (const heavy of ["pixi.js", "@pixi", "@dimforge", "peerjs", "socket.io-client", "toastify-js"]) expect(packages.has(heavy)).toBe(false);
  });
});
