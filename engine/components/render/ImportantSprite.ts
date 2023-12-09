import type { GameModel } from "@/game/GameModel";
import { ImportantSpriteSchema } from "@/schemas/render/ImportantSprite";
import { registerPixiComponent } from "../../components/ComponentRegistry";
import type { PixiSpriteSchema } from "./Sprite";
import { SpriteComponentPixi } from "./Sprite";
import { Viewport } from "pixi-viewport";

export class ImportantSpriteComponentPixi extends SpriteComponentPixi {
  schema = ImportantSpriteSchema;

  transform(
    pixiData: PixiSpriteSchema,
    entity: number,
    data: ImportantSpriteSchema,
    gameModel: GameModel,
    viewport: Viewport
  ) {
    super.transform(pixiData, entity, data, gameModel, viewport);
    const { container } = pixiData;

    const verticalDistanceFromCenter =
      Math.abs(pixiData.container.y - viewport.center.y) + pixiData.container.height / 2;
    const horizontalDistanceFromCenter =
      Math.abs(pixiData.container.x - viewport.center.x) + pixiData.container.width / 2;
    let offHorizontally = horizontalDistanceFromCenter - pixiData.container.width > 1920;
    let offVertically = verticalDistanceFromCenter - pixiData.container.height > 1080;
    if (offHorizontally || offVertically) {
      if (!offHorizontally && horizontalDistanceFromCenter > 1920) {
        offHorizontally = true;
      }
      if (!offVertically && verticalDistanceFromCenter > 1080) {
        offVertically = true;
      }

      if (offVertically) {
        if (container.y + pixiData.container.height / 2 > viewport.center.y) {
          container.y = viewport.center.y + 1080 - pixiData.container.height / 2 - data.padding;
        } else {
          container.y = viewport.center.y - 1080 + pixiData.container.height / 2 + data.padding;
        }
      }
      if (offHorizontally) {
        if (container.x > viewport.center.x) {
          container.x = viewport.center.x + 1920 - pixiData.container.width / 2 - data.padding;
        } else {
          container.x = viewport.center.x - 1920 + pixiData.container.width / 2 + data.padding;
        }
      }
      container.visible = true;
    } else if (data.hideInView) {
      container.visible = false;
    }
  }
}

registerPixiComponent("ImportantSprite", ImportantSpriteComponentPixi);
