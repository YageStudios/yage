import { Component, DrawSystemImpl, Schema, System, SystemImpl, defaultValue, type, type World } from "minecs";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { describe, expect, test } from "vitest";
import { createLeanGameModel, type LeanGameModel } from "yage/game/LeanGameModel";
import { leanWorldType } from "yage/world/lean";
import { setGamePaused } from "yage/game/pause";

@Component("LgmPos")
class LgmPos extends Schema {
  @type("number") @defaultValue(0) x: number;
}
@Component("LgmSprite")
class LgmSprite extends Schema {
  @type("number") @defaultValue(0) drawn: number;
}

const cleaned: number[] = [];
@System(LgmPos)
class LgmMove extends SystemImpl<LeanGameModel> {
  run = (model: LeanGameModel, eid: number) => {
    model.getTypedUnsafe(LgmPos, eid).x += model.frameDt;
  };
  cleanup = (_model: LeanGameModel, eid: number) => {
    cleaned.push(eid);
  };
}
@System(LgmPos, LgmSprite)
class LgmDraw extends DrawSystemImpl<LeanGameModel> {
  init = (model: LeanGameModel, eid: number) => {
    // What PixiViewportSystem.init reads and writes.
    expect(model.roomId).toBe("scene");
    expect(Array.isArray(model.players) && Array.isArray(model.localNetIds)).toBe(true);
    if (!model.hasComponent("LgmSprite", eid)) model.addComponent(LgmSprite, eid);
  };
  run = (model: LeanGameModel, eid: number) => {
    model.getTypedUnsafe(LgmSprite, eid).drawn = model.getTypedUnsafe(LgmPos, eid).x;
  };
}

describe("LeanGameModel", () => {
  test("is a local scene by default: one local net id (PixiViewportCleanupSystem keeps its viewport)", () => {
    expect(createLeanGameModel().localNetIds).toEqual(["local"]);
    expect(createLeanGameModel({ localNetIds: [] }).localNetIds).toEqual([]);
  });
  test("drives its own systems with GameModel-style accessors, honours paused, and cleans up on destroy", () => {
    const model = createLeanGameModel({ world: leanWorldType({ size: 16, systems: [LgmMove, LgmDraw] }), roomId: "scene" });
    const eid = model.addEntity();
    model.addComponent(LgmPos, eid, { x: 1 });
    model.addComponent("LgmSprite", eid);
    model.run(10);
    expect(model.getTypedUnsafe(LgmPos, eid).x).toBe(11);
    expect(model.getTyped(LgmSprite, eid)!.drawn).toBe(11);
    expect(model.frameDt).toBe(10);
    expect(model.timeElapsed).toBe(10);

    model.paused = true;
    model.run(10);
    expect(model.getTypedUnsafe(LgmPos, eid).x).toBe(11);
    model.paused = false;
    // The engine pause (yage/game/pause) holds every model too.
    setGamePaused(true);
    model.run(10);
    expect(model.getTypedUnsafe(LgmPos, eid).x).toBe(11);
    setGamePaused(false);

    expect([...model.getComponentActives(LgmPos)]).toEqual([eid]);
    expect(model.getComponentActives("PlayerType")).toEqual([]);
    expect(model.players).toEqual([]);
    expect(model.hasComponent("PlayerType", eid)).toBe(false);
    expect(model.getComponent("PlayerType", eid)).toBeNull();
    expect(model.getSystem(LgmMove)).toBeInstanceOf(LgmMove);
    expect(model.getSystemsByType("LgmPos", eid).map((s) => s.constructor)).toEqual([LgmMove, LgmDraw]);
    expect(() => model.addComponent("NoSuchComponent", eid)).toThrow(/unknown component NoSuchComponent/);

    model.removeComponent(LgmSprite, eid);
    expect(model.hasComponent(LgmSprite, eid)).toBe(false);
    model.destroy();
    expect(cleaned).toContain(eid);
    expect(model.destroyed).toBe(true);
  });

  test("wraps an existing world", () => {
    const world = leanWorldType({ components: [LgmPos] }).create(4) as World;
    const model = createLeanGameModel({ world });
    expect(model as unknown).toBe(world);
    expect(model.getComponentActives(LgmSprite)).toEqual([]);
  });

  test("imports no engine registry, physics or entity factory", async () => {
    const entry = fileURLToPath(new URL("../../engine/game/LeanGameModel.ts", import.meta.url));
    const result = await build({ entryPoints: [entry], bundle: true, write: false, metafile: true, format: "esm", platform: "browser", conditions: ["yage-source"], logLevel: "silent", alias: { yage: fileURLToPath(new URL("../../engine", import.meta.url)) } });
    const engine = Object.keys(result.metafile!.inputs).filter((p) => p.includes("engine/")).map((p) => p.slice(p.indexOf("engine/"))).sort();
    expect(engine).toEqual(["engine/game/LeanGameModel.ts", "engine/game/Timing.ts", "engine/game/pause.ts", "engine/world/context.ts", "engine/world/lean.ts"]);
    expect(Object.keys(result.metafile!.inputs).some((p) => /rapier|pixi/.test(p))).toBe(false);
  });
});
