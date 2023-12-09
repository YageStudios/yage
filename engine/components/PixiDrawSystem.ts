import type { Schema } from "@/decorators/type";
import type { GameModel } from "@/game/GameModel";
import { Viewport } from "pixi-viewport";

export interface PixiDrawSystem {
  ids: Set<number>;
  schema?: typeof Schema;
  debug?: boolean;

  init: (entity: number, gameModel: GameModel, viewport: Viewport) => void;
  run: (entity: number, gameModel: GameModel, viewport: Viewport) => void;
  cleanup: (entity: number, gameModel: GameModel, viewport: Viewport) => void;
}
