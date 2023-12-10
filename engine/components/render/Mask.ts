import { Viewport } from "pixi-viewport";
import { GameModel } from "@/game/GameModel";
import ImageLoader from "@/loader/ImageLoader";
import * as PIXI from "pixi.js";
import { registerPixiComponent } from "@/components/ComponentRegistry";
import { PixiDrawSystem } from "@/components/PixiDrawSystem";
import { MaskSchema } from "@/schemas/render/Mask";

class MaskPixiSystem implements PixiDrawSystem {
  ids: Set<number> = new Set();
  schema = MaskSchema;

  init(entity: number, gameModel: GameModel, viewport: Viewport) {
    const spriteData = gameModel.getTyped(entity, MaskSchema);
    const pixiSystem = gameModel.getPixiSystem<any>(spriteData.pixiComponent);

    if (!pixiSystem.instances[entity]) {
      return;
    }
    const imageTexture = ImageLoader.getInstance().getPixiTexture(spriteData.maskKey);
    const mask = PIXI.Sprite.from(imageTexture);

    pixiSystem.instances[entity].container.addChild(mask);

    if (pixiSystem.instances[entity].sprite) {
      mask.width = spriteData.width || pixiSystem.instances[entity].sprite.width;
      mask.height = spriteData.height || pixiSystem.instances[entity].sprite.height;

      pixiSystem.instances[entity].sprite.mask = mask;
      mask.anchor.set(spriteData.anchorX, spriteData.anchorY);
    } else if (pixiSystem.instances[entity].graphic) {
      pixiSystem.instances[entity].container.addChild(mask);
      mask.width = spriteData.width || pixiSystem.instances[entity].graphic.width;
      mask.height = spriteData.height || pixiSystem.instances[entity].graphic.height;
      pixiSystem.instances[entity].graphic.mask = mask;
      mask.anchor.set(spriteData.anchorX, spriteData.anchorY);
    }
    this.ids.add(entity);
  }

  run(entity: number, gameModel: GameModel, viewport: Viewport) {
    if (!this.ids.has(entity)) {
      this.init(entity, gameModel, viewport);
    }
  }
  cleanup(entity: number, gameModel: GameModel, viewport: Viewport) {
    this.ids.delete(entity);
  }
}

registerPixiComponent("Mask", MaskPixiSystem);
