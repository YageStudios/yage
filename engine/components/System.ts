import type { Schema } from "../decorators/type";
import type { GameModel } from "@/game/GameModel";

export interface System {
  schema: typeof Schema;
  type: string;

  depth?: number;
  dependencies?: string[];
  intraFrame?: number;

  init?: (entity: number, gameModel: GameModel) => void;

  runAll?(gameModel: GameModel): void;
  run?: (entity: number, gameModel: GameModel) => void;

  cleanup?: (entity: number, gameModel: GameModel, ejecting: boolean) => void;
}
