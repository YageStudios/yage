import { DEPTHS, registerSystem } from "@/components/ComponentRegistry";
import type { GameModel } from "@/game/GameModel";
import { RandomSchema } from "@/schemas/core/Random";
import { generate } from "../../utils/rand";
import type { System } from "../System";
import { ComponentCategory } from "../types";

class RandomSystem implements System {
  type = "Random";
  category = Number.MIN_VALUE;
  schema = RandomSchema;
  depth = DEPTHS.CORE;

  init(entity: number, gameModel: GameModel) {
    const r = gameModel.getTyped(entity, RandomSchema);

    r.random = generate(gameModel.frame);
  }

  run = (entity: number, gameModel: GameModel) => {
    const r = gameModel.getTyped(entity, RandomSchema);

    r.random = generate(gameModel.frame);
  };
}

registerSystem(RandomSystem);
