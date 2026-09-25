import { beforeEach, test, expect } from "vitest";
import { createWorld, Component, Schema, System, SystemImpl, type, defaultValue } from "minecs";
import { GameModel } from "yage/game/GameModel";
import type { GameModel as GameModelType } from "yage/game/GameModel";
import { InputManager } from "yage/inputs/InputManager";
import { PlayerEventManager } from "yage/inputs/PlayerEventManager";
import { ComponentCategory } from "yage/constants/enums";

@Component(ComponentCategory.ONE_OFF)
class RunModsProbe extends Schema {
  @defaultValue(0)
  @type("number")
  marker: number;

  @defaultValue(-1)
  @type("number")
  owner: number;
}

const calls: string[] = [];

@System(RunModsProbe)
class ProbeEarlySystem extends SystemImpl<GameModelType> {
  static depth = -20;
  run = (_gameModel: GameModelType, entity: number) => {
    calls.push(`early:${entity}`);
  };
}

@System(RunModsProbe)
class ProbeLateSystem extends SystemImpl<GameModelType> {
  static depth = -10;
  run = (_gameModel: GameModelType, entity: number) => {
    calls.push(`late:${entity}`);
  };
}

// Per-frame systems (depth >= 0) must never run through runMods.
@System(RunModsProbe)
class ProbeAutoSystem extends SystemImpl<GameModelType> {
  static depth = 0;
  run = (_gameModel: GameModelType, entity: number) => {
    calls.push(`auto:${entity}`);
  };
}

const buildModel = () =>
  GameModel({
    seed: "runmods",
    roomId: "runmods",
    world: createWorld(100),
    inputManager: new InputManager(),
    playerEventManager: new PlayerEventManager(),
  });

const addProbedEntity = (gameModel: GameModelType, marker: number) => {
  const entity = gameModel.addEntity();
  gameModel.addComponent(RunModsProbe, entity, { marker });
  return entity;
};

beforeEach(() => {
  calls.length = 0;
});

test("runs each manual system once per entity, in depth order", () => {
  const gameModel = buildModel();
  const e1 = addProbedEntity(gameModel, 1);
  const e2 = addProbedEntity(gameModel, 2);

  gameModel.runMods([e1, e2], ComponentCategory.ONE_OFF);

  expect(calls).toEqual([`early:${e1}`, `early:${e2}`, `late:${e1}`, `late:${e2}`]);
});

test("skips entities missing the system's components when overrides are present", () => {
  const gameModel = buildModel();
  const e1 = addProbedEntity(gameModel, 1);
  const e2 = addProbedEntity(gameModel, 2);
  const bare = gameModel.addEntity();

  gameModel.runMods([bare, e1, e2], ComponentCategory.ONE_OFF, { owner: 7 });
  // A missing entity in the middle must not shift the loop onto the next entity.
  expect(calls).toEqual([`early:${e1}`, `early:${e2}`, `late:${e1}`, `late:${e2}`]);

  calls.length = 0;
  gameModel.runMods([e1, e2, bare], ComponentCategory.ONE_OFF, { owner: 7 });
  // A missing entity at the end must not run the system with an undefined entity.
  expect(calls).toEqual([`early:${e1}`, `early:${e2}`, `late:${e1}`, `late:${e2}`]);
});

test("collapses duplicate entity ids into a single pass", () => {
  const gameModel = buildModel();
  const e1 = addProbedEntity(gameModel, 1);
  const e2 = addProbedEntity(gameModel, 2);

  gameModel.runMods([e2, e2, e1], ComponentCategory.ONE_OFF, { owner: 7 });

  expect(calls).toEqual([`early:${e2}`, `early:${e1}`, `late:${e2}`, `late:${e1}`]);
});

test("applies overrides to matching category components before run", () => {
  const gameModel = buildModel();
  const e1 = addProbedEntity(gameModel, 1);
  const seenComponents: number[][] = [];

  gameModel.runMods([e1], ComponentCategory.ONE_OFF, { owner: 42, marker: 9 }, (_system, components) => {
    seenComponents.push(components.map((component: any) => component.marker));
  });

  expect(gameModel.getTypedUnsafe(RunModsProbe, e1).owner).toBe(42);
  expect(gameModel.getTypedUnsafe(RunModsProbe, e1).marker).toBe(9);
  // Both systems collected the (already overridden) probe component for the after callback.
  expect(seenComponents).toEqual([[9], [9]]);
});

test("after returning false consumes the current entity and continues with the rest", () => {
  const gameModel = buildModel();
  const e1 = addProbedEntity(gameModel, 1);
  const e2 = addProbedEntity(gameModel, 2);

  gameModel.runMods([e1, e2], ComponentCategory.ONE_OFF, undefined, () => false);

  expect(calls).toEqual([`early:${e1}`, `early:${e2}`, `late:${e1}`, `late:${e2}`]);
});

test("isLast is true only for the final manual system's final entity", () => {
  const gameModel = buildModel();
  const e1 = addProbedEntity(gameModel, 1);
  const e2 = addProbedEntity(gameModel, 2);
  const flags: boolean[] = [];

  gameModel.runMods([e1, e2], ComponentCategory.ONE_OFF, undefined, (_system, _components, _overrides, isLast) => {
    flags.push(isLast);
  });

  expect(calls).toEqual([`early:${e1}`, `early:${e2}`, `late:${e1}`, `late:${e2}`]);
  expect(flags).toEqual([false, false, false, true]);
});

test("handles a single entity without array wrapping", () => {
  const gameModel = buildModel();
  const e1 = addProbedEntity(gameModel, 1);

  gameModel.runMods(e1, ComponentCategory.ONE_OFF, { owner: 5 });

  expect(calls).toEqual([`early:${e1}`, `late:${e1}`]);
  expect(gameModel.getTypedUnsafe(RunModsProbe, e1).owner).toBe(5);
});
