import { Viewport } from "pixi-viewport";
import { GameModel } from "@/game/GameModel";
import * as PIXI from "pixi.js";
import { registerPixiComponent } from "@/components/ComponentRegistry";
import { PixiDrawSystem } from "@/components/PixiDrawSystem";
import { TransformSchema } from "@/schemas/entity/Transform";
import { AttachSchema } from "@/schemas/entity/Attach";
import { RadiusSchema } from "@/schemas/entity/Radius";
import { GraphicSchema } from "@/schemas/render/Graphic";
import { hexToRgbNumber } from "@/utils/colors";

export type PixiGraphicsSchema = {
  graphic: PIXI.Graphics;
  container: PIXI.Container;
  debug?: PIXI.Container;
};

export class GraphicPixiSystem implements PixiDrawSystem {
  ids: Set<number> = new Set();
  schema = GraphicSchema;

  instances: {
    [id: number]: PixiGraphicsSchema;
  } = {};

  transform(
    pixiData: PixiGraphicsSchema,
    entity: number,
    data: GraphicSchema,
    gameModel: GameModel,
    viewport: Viewport
  ) {
    const { graphic, container } = pixiData;
    graphic.pivot.set(data.anchorX * graphic.width, data.anchorY * graphic.height);

    if (data.rotation) {
      const angle = (data.rotation * Math.PI) / 180;

      graphic.rotation = angle;
    }

    if (container.scale.x !== data.scale) {
      container.scale.set(data.scale);
    }

    const verticalDistanceFromCenter = Math.abs(pixiData.container.y - viewport.center.y);
    const horizontalDistanceFromCenter = Math.abs(pixiData.container.x - viewport.center.x);
    if (
      horizontalDistanceFromCenter - pixiData.container.width / 2 > 1920 ||
      verticalDistanceFromCenter - pixiData.container.height / 2 > 1080
    ) {
      container.visible = false;
    } else {
      container.visible = true;
    }
  }

  init(entity: number, gameModel: GameModel, viewport: Viewport) {
    let zIndex = 2;

    const instance: Partial<PixiGraphicsSchema> = {
      container: this.instances[entity]?.container ?? new PIXI.Container(),
      debug: this.instances[entity]?.debug,
    };

    if (!instance.debug) {
      instance.debug = new PIXI.Container();
      instance.debug.visible = false;
      viewport.addChild(instance.debug);
    }

    const graphicData = gameModel.getTypedUnsafe(entity, GraphicSchema);
    const graphics = new PIXI.Graphics();

    if (graphicData.fillColor) {
      graphics.beginFill(hexToRgbNumber(graphicData.fillColor));
    }

    if (graphicData.strokeColor) {
      graphics.lineStyle(graphicData.lineWidth || 1, hexToRgbNumber(graphicData.strokeColor));
    }

    if (graphicData.circle) {
      graphics.drawCircle(graphicData.circle.x, graphicData.circle.y, graphicData.circle.radius);
    }

    if (graphicData.ellipse) {
      graphics.drawEllipse(
        graphicData.ellipse.x,
        graphicData.ellipse.y,
        graphicData.ellipse.width,
        graphicData.ellipse.height
      );
    }

    if (graphicData.rectangle) {
      graphics.drawRect(
        graphicData.rectangle.x,
        graphicData.rectangle.y,
        graphicData.rectangle.width,
        graphicData.rectangle.height
      );
    }

    if (graphicData.polygon) {
      graphics.drawPolygon(graphicData.polygon);
    }

    graphics.endFill();

    instance.container!.addChild(graphics);

    instance.graphic = graphics;

    instance.container!.zIndex = zIndex;
    instance.graphic.position.set(0, 0);

    this.instances[entity] = instance as PixiGraphicsSchema;
    viewport.addChild(instance.container!);
    this.ids.add(entity);
  }

  run(entity: number, gameModel: GameModel, viewport: Viewport) {
    const spriteData = gameModel.getTypedUnsafe(entity, this.schema);

    if (!this.instances[entity]) {
      this.init(entity, gameModel, viewport);
    }
    const pixiData = this.instances[entity];
    const { graphic, container, debug } = pixiData;

    if (spriteData.opacity === 0) {
      graphic.visible = false;
    } else {
      graphic.visible = true;
      // sprite.alpha = spriteData.opacity;
      graphic.alpha = 1;
    }
    const transformSchema = gameModel.getTypedUnsafe(entity, TransformSchema);

    const position = transformSchema.position;

    position.y -= transformSchema.z;

    let xoffset = spriteData.xoffset ?? 0;
    let yoffset = spriteData.yoffset ?? 0;

    const viewY = viewport.position.y;

    if (gameModel.hasComponent(entity, AttachSchema)) {
      const owner = gameModel.getComponentUnsafe(entity, AttachSchema).parent;
      container.zIndex =
        TransformSchema.store.y[owner] -
        viewY +
        TransformSchema.store.z[owner] +
        RadiusSchema.store.radius[owner] +
        spriteData.zIndex;
    } else {
      // const mapStripe = TransformSchema.store.y[entity] / 320;
      container.zIndex =
        TransformSchema.store.y[entity] -
        viewY +
        TransformSchema.store.z[entity] +
        RadiusSchema.store.radius[entity] +
        spriteData.zIndex;
    }

    container.x = position.x + xoffset;
    container.y = position.y + yoffset;

    debug?.position.set(position.x, position.y);

    this.transform(pixiData, entity, spriteData, gameModel, viewport);
  }

  cleanup(entity: number, gameModel: GameModel, viewport: Viewport) {
    const instanceData = this.instances[entity];
    if (!instanceData) {
      return;
    }
    instanceData.container.destroy();
    const instance = this.instances[entity].graphic;
    instance.destroy();
    delete this.instances[entity];
    this.ids.delete(entity);
  }
}

registerPixiComponent("Graphic", GraphicPixiSystem);
