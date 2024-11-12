import { System, DrawSystemImpl } from "minecs";
import { ReadOnlyGameModel } from "yage/game/GameModel";
import { UIService } from "yage/ui/UIService";
import { UiCleanupOnLeave } from "yage/schemas/render/UiCleanupOnLeave";

@System(UiCleanupOnLeave)
export class UiCleanupOnLeaveSystem extends DrawSystemImpl<ReadOnlyGameModel> {
  static depth = -1;

  run = (gameModel: ReadOnlyGameModel) => {
    if (gameModel.localNetIds.length > 0) {
      return;
    }
    UIService.getInstance().clearUI();
  };
}
