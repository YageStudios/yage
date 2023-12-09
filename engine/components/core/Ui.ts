import { Schema } from "@/decorators/type";
import { GameModel } from "@/game/GameModel";
import { System } from "../System";
import { UiSchema } from "@/schemas/core/Ui";
import AssetLoader from "@/loader/AssetLoader";
import { registerUIComponent } from "../ComponentRegistry";
import { UIService } from "@/ui/UIService";

registerUIComponent(
  "Ui",
  (uiService: UIService, entity: number, gameModel: GameModel) => {
    const data = gameModel.getTyped<UiSchema>(entity, UiSchema);

    if (!data.ui) {
      const uiConfigs = AssetLoader.getInstance().getUi(data.key);
      data.ui = [];
      for (const uiConfig of uiConfigs) {
        const ui = uiService.createUIElement(uiConfig);
      }
    }
  },
  {
    cleanup: (config: UIService, entity: number, gameModel: GameModel) => {},
  }
);
