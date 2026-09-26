import { vi } from "vitest";
import { createWorld } from "minecs";
import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import { GameModel } from "yage/game/GameModel";
import { InputManager } from "yage/inputs/InputManager";
import { PlayerEventManager } from "yage/inputs/PlayerEventManager";

// The fake window object in test/setup.ts traps Rapier's WASM mid-step; the
// real global is a superset of what that stub provides. Engine modules may
// evaluate under the setup stub, but call this before creating game models.
export const setupRealPhysicsGlobals = () => {
  vi.stubGlobal("window", globalThis);
  const globalAny = globalThis as any;
  globalAny.addEventListener = globalAny.addEventListener ?? (() => {});
  globalAny.removeEventListener = globalAny.removeEventListener ?? (() => {});
  globalAny.__YAGE__ = {
    EntityFactory: {
      generateEntity: (gameModel: { addEntity: () => number }) => gameModel.addEntity(),
    },
  };
};

export const initRapier = async () => {
  await RAPIER.init();
};

export const makeTestGame = (seed: string) =>
  GameModel({
    seed,
    roomId: seed,
    world: createWorld(),
    inputManager: new InputManager(),
    playerEventManager: new PlayerEventManager(),
  });
