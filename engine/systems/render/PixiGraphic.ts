import type { Viewport } from "pixi-viewport";
import * as PIXI from "pixi.js";
import { Transform } from "yage/schemas/entity/Transform";
import { Attach } from "yage/schemas/entity/Attach";
import { Radius } from "yage/schemas/entity/Radius";
import { PixiGraphic } from "yage/schemas/render/PixiGraphic";
import { hexToRgbNumber } from "yage/utils/colors";
import { DrawSystemImpl, System, getSystem } from "minecs";
import { ComponentCategory } from "../types";
import type { ReadOnlyGameModel } from "yage/game/GameModel";
import { PixiViewportSystem } from "./PixiViewport";

export type PixiGraphics = {
  graphic: PIXI.Graphics;
  container: PIXI.Container;
  current: PixiGraphic;
  debug?: PIXI.Container;
};

@System(PixiGraphic)
export class GraphicDrawSystem extends DrawSystemImpl<ReadOnlyGameModel> {
  static depth = 2;
  static category = ComponentCategory.RENDERING;

  instances: {
    [id: number]: PixiGraphics;
  } = {};

  transform(
    pixiData: PixiGraphics,
    entity: number,
    data: PixiGraphic,
    renderModel: ReadOnlyGameModel,
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

  drawGraphic(graphicData: PixiGraphic, graphics: PIXI.Graphics = new PIXI.Graphics()) {
    graphics.clear();

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

    return graphics;
  }

  init = (renderModel: ReadOnlyGameModel, entity: number) => {
    const viewport = getSystem(renderModel, PixiViewportSystem).viewport;
    const zIndex = 2;

    const instance: PixiGraphics = {
      container: this.instances[entity]?.container ?? new PIXI.Container(),
      debug: this.instances[entity]?.debug,
      graphic: null as any,
      current: { ...renderModel(PixiGraphic, entity) },
    };

    if (!instance.debug) {
      instance.debug = new PIXI.Container();
      instance.debug.visible = false;
      viewport.addChild(instance.debug);
    }

    const graphics = this.drawGraphic(instance.current);

    instance.container.addChild(graphics);
    instance.graphic = graphics;
    instance.container.zIndex = zIndex;
    instance.graphic.position.set(0, 0);

    this.instances[entity] = instance;
    viewport.addChild(instance.container);
  };

  run = (renderModel: ReadOnlyGameModel, entity: number) => {
    const viewport = getSystem(renderModel, PixiViewportSystem).viewport;
    const graphicData = renderModel.getTypedUnsafe(PixiGraphic, entity);

    if (!this.instances[entity]) {
      this.init(renderModel, entity);
    }
    let pixiData = this.instances[entity];
    let { graphic, container, debug, current } = pixiData;
    if (
      graphicData.circle?.radius !== current.circle?.radius ||
      graphicData.circle?.x !== current.circle?.x ||
      graphicData.circle?.y !== current.circle?.y ||
      graphicData.ellipse?.height !== current.ellipse?.height ||
      graphicData.ellipse?.width !== current.ellipse?.width ||
      graphicData.ellipse?.x !== current.ellipse?.x ||
      graphicData.ellipse?.y !== current.ellipse?.y ||
      graphicData.rectangle?.height !== current.rectangle?.height ||
      graphicData.rectangle?.width !== current.rectangle?.width ||
      graphicData.rectangle?.x !== current.rectangle?.x ||
      graphicData.rectangle?.y !== current.rectangle?.y ||
      graphicData.polygon?.length !== current.polygon?.length ||
      !graphicData.polygon?.every((v, i) => v === current.polygon[i])
    ) {
      this.drawGraphic(graphicData, graphic);
      pixiData.current = { ...renderModel(PixiGraphic, entity) };
      pixiData = this.instances[entity];
      ({ graphic, container, debug, current } = pixiData);
    }

    if (graphicData.opacity === 0) {
      graphic.visible = false;
    } else {
      graphic.visible = true;
      // sprite.alpha = spriteData.opacity;
      graphic.alpha = 1;
    }
    graphic.visible = true;
    const transform = renderModel.getTypedUnsafe(Transform, entity);

    const position = { x: transform.x, y: transform.y };

    position.y -= transform.z;

    const xoffset = graphicData.xoffset ?? 0;
    const yoffset = graphicData.yoffset ?? 0;

    const viewY = viewport.position.y;

    if (graphicData.inheritParentZIndex && renderModel.hasComponent(Attach, entity)) {
      const owner = renderModel.getTypedUnsafe(Attach, entity).parent;
      if (owner !== null) {
        container.zIndex =
          renderModel(Transform).store.y[owner] -
          viewY +
          renderModel(Transform).store.z[owner] +
          renderModel(Radius).store.radius[owner] +
          graphicData.zIndex;
      }
    } else if (graphicData.relativeZIndex) {
      // const mapStripe = Transform.store.y[entity] / 320;
      container.zIndex =
        renderModel(Transform).store.y[entity] -
        viewY +
        renderModel(Transform).store.z[entity] +
        renderModel(Radius).store.radius[entity] +
        graphicData.zIndex;
    }

    container.x = position.x + xoffset;
    container.y = position.y + yoffset;

    debug?.position.set(position.x, position.y);

    this.transform(pixiData, entity, graphicData, renderModel, viewport);
  };

  cleanup = (renderModel: ReadOnlyGameModel, entity: number) => {
    const instanceData = this.instances[entity];
    if (!instanceData) {
      return;
    }
    instanceData.container.destroy();
    const instance = this.instances[entity].graphic;
    instance.destroy();
    delete this.instances[entity];
  };
}
