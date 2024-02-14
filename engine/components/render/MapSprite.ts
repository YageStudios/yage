import { GameModel } from "@/game/GameModel";
import { MapSpriteSchema } from "@/schemas/render/MapSprite";
import { PixiDrawSystem } from "../PixiDrawSystem";
import * as PIXI from "pixi.js";
import ImageLoader from "@/loader/ImageLoader";
import { TransformSchema } from "@/schemas/entity/Transform";
import { registerPixiComponent, registerSystem } from "../ComponentRegistry";
import { Viewport } from "pixi-viewport";
import { MapEntityTypeSchema } from "../entity/Types";

export class MapSpriteComponentPixi implements PixiDrawSystem {
  ids: Set<number> = new Set();
  schema = MapSpriteSchema;
  entities: {
    [key: number]: PIXI.Sprite;
  } = {};
  init(entity: number, gameModel: GameModel, viewport: Viewport) {
    const spriteData = gameModel.getTyped(entity, MapSpriteSchema);
    const mapEntityType = gameModel.getTyped(entity, MapEntityTypeSchema);
    const sprite = new PIXI.Sprite(ImageLoader.getInstance().getPixiTexture(spriteData.name));

    const transformSchema = gameModel.getTyped(entity, TransformSchema);
    const position = transformSchema.position;

    sprite.anchor.set(0.5, 0.5);
    sprite.x = position.x;
    sprite.y = position.y; // - mapEntityType.height;
    sprite.width = mapEntityType.width;
    sprite.height = mapEntityType.height;
    sprite.zIndex = 100;

    this.entities[entity] = sprite;
    this.ids.add(entity);

    viewport.addChild(sprite);
  }
  run(entity: number, gameModel: GameModel, viewport: Viewport) {
    const sprite = this.entities[entity];
    const spriteData = gameModel.getTyped(entity, MapSpriteSchema);
    if (spriteData.opacity) {
      sprite.alpha = spriteData.opacity;
      sprite.visible = true;
    } else {
      sprite.visible = false;
    }
  }
  cleanup(entity: number, gameModel: GameModel, viewport: Viewport) {
    const sprite = this.entities[entity];
    viewport.removeChild(sprite);
    this.ids.delete(entity);
    delete this.entities[entity];
  }
}

registerPixiComponent("MapSprite", MapSpriteComponentPixi);
