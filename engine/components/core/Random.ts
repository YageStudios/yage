import { DEPTHS, registerSystem } from "@/components/ComponentRegistry";
import type { GameModel } from "@/game/GameModel";
import { RandomSchema } from "@/schemas/core/Random";
import { generate } from "../../utils/rand";
import type { System } from "../System";
import { ComponentCategory } from "../types";

const stringToNumber = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
};
class RandomSystem implements System {
  type = "Random";
  category = ComponentCategory.CORE;
  schema = RandomSchema;
  depth = DEPTHS.CORE;

  init(entity: number, gameModel: GameModel) {
    const r = gameModel.getTyped(entity, RandomSchema);

    if (!r.seedNumber) {
      if (r.seed) {
        r.seedNumber = stringToNumber(r.seed);
      } else {
        r.seedNumber = 0;
      }
    }

    r.random = generate(gameModel.frame + r.seedNumber);
  }

  run = (entity: number, gameModel: GameModel) => {
    const r = gameModel.getTyped(entity, RandomSchema);

    r.random = generate(gameModel.frame + r.seedNumber);
  };
}

registerSystem(RandomSystem);
