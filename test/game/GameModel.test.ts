import { createWorld } from "minecs";
import { test, expect } from "vitest";
import { GameModel } from "yage/game/GameModel";
import { InputManager } from "yage/inputs/InputManager";
import { PlayerEventManager } from "yage/inputs/PlayerEventManager";

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
  expect(gameModel.timeElapsed).toBe(16);
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
