import type { GameModel } from "yage/game/GameModel";
import { Random } from "yage/schemas/core/Random";
import { generate } from "yage/utils/rand";
import { ComponentCategory } from "../types";
import { DEPTHS } from "yage/constants/enums";
import { System, SystemImpl } from "minecs";

const stringToNumber = (str: string) => {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return hash;
};

@System(ComponentCategory.CORE, Random)
class RandomSystem extends SystemImpl<GameModel> {
  static depth = DEPTHS.CORE;

  init = (gameModel: GameModel, entity: number) => {
    const r = gameModel.getTypedUnsafe(Random, entity);

    if (!r.seedNumber) {
      if (r.seed) {
        r.seedNumber = stringToNumber(r.seed);
      } else {
        r.seedNumber = 0;
      }
    }

    r.random = gameModel.frame + r.seedNumber;
    gameModel.rand = generate(r.random);
  };

  run = (gameModel: GameModel, entity: number) => {
    const r = gameModel.getTypedUnsafe(Random, entity);

    r.random = gameModel.frame + r.seedNumber;
    gameModel.rand = generate(r.random);
  };
}
