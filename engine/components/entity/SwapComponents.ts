import { ComponentCategory } from "@/components/types";
import type { System } from "../../components/System";
import type { GameModel } from "@/game/GameModel";
import { registerSystem } from "../../components/ComponentRegistry";
import { SwapComponentsSchema } from "@/schemas/entity/SwapComponents";

export class SwapComponentsSystem implements System {
  type = "SwapComponents";
  category: ComponentCategory = ComponentCategory.CORE;
  schema = SwapComponentsSchema;

  run(entity: number, gameModel: GameModel) {
    const nextSwapSet = [];
    const nextSwapData = [];

    const swapComponents = gameModel.getTypedUnsafe(entity, SwapComponentsSchema);
    for (let i = 0; i < swapComponents.swapComponents.length; i++) {
      if (gameModel.hasComponent(entity, swapComponents.swapComponents[i])) {
        nextSwapData.push(gameModel.ejectComponent(entity, swapComponents.swapComponents[i]));
      }
    }
    for (let i = 0; i < swapComponents.swapData.length; i++) {
      gameModel.setComponent(entity, swapComponents.swapData[i].type, swapComponents.swapData[i].data);
      nextSwapSet.push(swapComponents.swapData[i].type);
    }

    swapComponents.swapComponents = nextSwapSet;
    swapComponents.swapData = nextSwapData;
    swapComponents.swapped = !swapComponents.swapped;
  }
}

registerSystem(SwapComponentsSystem);
