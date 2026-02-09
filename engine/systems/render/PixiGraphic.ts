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
import { SpatialHash2d } from "yage/utils/SpatialHash2d";

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
  private static readonly CULL_X = 2200;
  private static readonly CULL_Y = 1300;
  private static readonly HASH_CELL_SIZE = 256;
  private static readonly CULL_PADDING = 256;

  instances: {
    [id: number]: PixiGraphics;
  } = {};

  private _cachedViewY = 0;
  private _cachedViewYTime = -1;
  private _spatialHash = new SpatialHash2d(GraphicDrawSystem.HASH_CELL_SIZE);
  private _indexed = new Set<number>();
  private _lastVisible = new Set<number>();

  private getViewBounds(viewport: Viewport) {
    const topLeft = viewport.toWorld(0, 0);
    const bottomRight = viewport.toWorld(viewport.screenWidth, viewport.screenHeight);
    return {
      minX: Math.min(topLeft.x, bottomRight.x) - GraphicDrawSystem.CULL_PADDING,
      minY: Math.min(topLeft.y, bottomRight.y) - GraphicDrawSystem.CULL_PADDING,
      maxX: Math.max(topLeft.x, bottomRight.x) + GraphicDrawSystem.CULL_PADDING,
      maxY: Math.max(topLeft.y, bottomRight.y) + GraphicDrawSystem.CULL_PADDING,
    };
  }

  transform(
    pixiData: PixiGraphics,
    entity: number,
    data: PixiGraphic,
    renderModel: ReadOnlyGameModel,
    viewport: Viewport,
  ) {
    const { graphic, container } = pixiData;
    const horizontalDistanceFromCenter = Math.abs(container.x - viewport.center.x);
    const verticalDistanceFromCenter = Math.abs(container.y - viewport.center.y);
    if (
      horizontalDistanceFromCenter > GraphicDrawSystem.CULL_X ||
      verticalDistanceFromCenter > GraphicDrawSystem.CULL_Y
    ) {
      container.visible = false;
      return;
    }
    container.visible = true;

    graphic.pivot.set(data.anchorX * graphic.width, data.anchorY * graphic.height);

    if (data.rotation) {
      const angle = (data.rotation * Math.PI) / 180;

      graphic.rotation = angle;
    }

    if (container.scale.x !== data.scale) {
      container.scale.set(data.scale);
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
        graphicData.ellipse.height,
      );
    }

    if (graphicData.rectangle) {
      graphics.drawRect(
        graphicData.rectangle.x,
        graphicData.rectangle.y,
        graphicData.rectangle.width,
        graphicData.rectangle.height,
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

  runAll = (renderModel: ReadOnlyGameModel) => {
    const viewport = getSystem(renderModel, PixiViewportSystem).viewport;
    const entities = this.query(renderModel);
    const activeSet = new Set<number>(entities);

    for (const indexedEntity of this._indexed) {
      if (!activeSet.has(indexedEntity)) {
        this._spatialHash.remove(indexedEntity);
        this._indexed.delete(indexedEntity);
        this._lastVisible.delete(indexedEntity);
      }
    }

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
      const transform = renderModel.getTypedUnsafe(Transform, entity);
      const x = transform.x;
      const y = transform.y - transform.z;
      if (this._indexed.has(entity)) {
        this._spatialHash.update(entity, x, y);
      } else {
        this._spatialHash.insert(entity, x, y);
        this._indexed.add(entity);
      }
    }

    const bounds = this.getViewBounds(viewport);
    const candidates = this._spatialHash.query(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
    const visibleNow = new Set<number>();

    for (let i = 0; i < candidates.length; i++) {
      const entity = candidates[i];
      if (!activeSet.has(entity)) {
        continue;
      }
      visibleNow.add(entity);
      this.runEntity(renderModel, entity, viewport);
    }

    for (const entity of this._lastVisible) {
      if (!visibleNow.has(entity)) {
        const instanceData = this.instances[entity];
        if (instanceData) {
          instanceData.container.visible = false;
        }
      }
    }
    this._lastVisible = visibleNow;
  };

  run = (renderModel: ReadOnlyGameModel, entity: number) => {
    const viewport = getSystem(renderModel, PixiViewportSystem).viewport;
    this.runEntity(renderModel, entity, viewport);
  };

  private runEntity = (renderModel: ReadOnlyGameModel, entity: number, viewport: Viewport) => {
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
      graphic.alpha = graphicData.opacity ?? 1;
    }
    const transform = renderModel.getTypedUnsafe(Transform, entity);

    const positionX = transform.x;
    const positionY = transform.y - transform.z;

    const xoffset = graphicData.xoffset ?? 0;
    const yoffset = graphicData.yoffset ?? 0;

    if (this._cachedViewYTime !== renderModel.timeElapsed) {
      this._cachedViewY = viewport.toWorld(0, 0).y;
      this._cachedViewYTime = renderModel.timeElapsed;
    }
    const viewY = this._cachedViewY;

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

    container.x = positionX + xoffset;
    container.y = positionY + yoffset;

    debug?.position.set(positionX, positionY);

    this.transform(pixiData, entity, graphicData, renderModel, viewport);
  };

  cleanup = (renderModel: ReadOnlyGameModel, entity: number) => {
    this._spatialHash.remove(entity);
    this._indexed.delete(entity);
    this._lastVisible.delete(entity);

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
