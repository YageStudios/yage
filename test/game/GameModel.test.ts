import { createWorld } from "minecs";
import { test, expect } from "vitest";
import { GameModel } from "yage/game/GameModel";
import { InputManager } from "yage/inputs/InputManager";
import { PlayerEventManager } from "yage/inputs/PlayerEventManager";
import { FIXED_TIMESTEP_MS } from "yage/game/Timing";
import Description from "yage/schemas/core/Description";

test("GameModel built in random", () => {
  const gameModel = GameModel({
    seed: "test",
    roomId: "test",
    world: createWorld(),
    inputManager: new InputManager(),
    playerEventManager: new PlayerEventManager(),
  });
  expect(gameModel.timeElapsed).toBe(0);
  expect(gameModel.rand.int(10000)).toBe(3574);

  gameModel.step();

  expect(gameModel.frame).toBe(1);
  expect(gameModel.timeElapsed).toBe(FIXED_TIMESTEP_MS);
  expect(gameModel.rand.int(10000)).toBe(8669);

  const gameModel2 = GameModel({
    seed: "next seed",
    roomId: "test",
    world: createWorld(),
    inputManager: new InputManager(),
    playerEventManager: new PlayerEventManager(),
  });
  expect(gameModel2.timeElapsed).toBe(0);
  expect(gameModel2.rand.int(10000)).toBe(9554);
});

test("GameModel random is deterministic", () => {
  const gameModel = GameModel({
    seed: "test",
    roomId: "test",
    world: createWorld(),
    inputManager: new InputManager(),
    playerEventManager: new PlayerEventManager(),
  });
  expect(gameModel.rand.int(10000)).toBe(3574);
  gameModel.step();
  expect(gameModel.rand.int(10000)).toBe(8669);

  const gameModel2 = GameModel({
    seed: "test",
    roomId: "test",
    world: createWorld(),
    inputManager: new InputManager(),
    playerEventManager: new PlayerEventManager(),
  });
  expect(gameModel2.rand.int(10000)).toBe(3574);
  gameModel2.step();
  expect(gameModel2.rand.int(10000)).toBe(8669);
});

test("GameModel finds single entities (yage/world/single)", () => {
  const gameModel = GameModel({
    seed: "single",
    roomId: "single",
    world: createWorld(),
    inputManager: new InputManager(),
    playerEventManager: new PlayerEventManager(),
  });
  const eid = gameModel.addEntity();
  gameModel.addComponent(Description, eid, { description: "the one" });
  expect(gameModel.singleEntity(Description)).toBe(eid);
  expect(gameModel.single(Description).description).toBe("the one");
});
