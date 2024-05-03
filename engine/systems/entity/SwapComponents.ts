import type { GameModel } from "yage/game/GameModel";
import { SwapComponents } from "yage/schemas/entity/SwapComponents";
import { System, SystemImpl } from "minecs";
import { ComponentCategory } from "../types";

@System(SwapComponents)
export class SwapComponentsSystem extends SystemImpl<GameModel> {
  static category: ComponentCategory = ComponentCategory.CORE;
  static depth: number = -1;

  run = (gameModel: GameModel, entity: number) => {
    const nextSwapSet = [];
    const nextSwapData = [];

    const swapComponents = gameModel.getTypedUnsafe(SwapComponents, entity);
    for (let i = 0; i < swapComponents.swapComponents.length; i++) {
      if (gameModel.hasComponent(swapComponents.swapComponents[i], entity)) {
        const data = gameModel.ejectComponent(swapComponents.swapComponents[i], entity);
        if (data) {
          nextSwapData.push(data);
        }
      }
    }
    for (let i = 0; i < swapComponents.swapData.length; i++) {
      gameModel.addComponent(swapComponents.swapData[i].type, entity, swapComponents.swapData[i].data);
      nextSwapSet.push(swapComponents.swapData[i].type);
    }

    swapComponents.swapComponents = nextSwapSet;
    swapComponents.swapData = nextSwapData;
    swapComponents.swapped = !swapComponents.swapped;
  };
}
