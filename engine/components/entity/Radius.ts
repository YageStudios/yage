import * as PIXI from "pixi.js";
import { registerPixiComponent } from "@/components/ComponentRegistry";
import type { GameModel } from "@/game/GameModel";
import type { PixiDrawSystem } from "../../components/PixiDrawSystem";
import { RadiusSchema } from "@/schemas/entity/Radius";
import { TransformSchema } from "@/schemas/entity/Transform";
import { Viewport } from "pixi-viewport";

class DebugRadiusDraw implements PixiDrawSystem {
  ids: Set<number> = new Set();
  entities: {
    [id: number]: { container: PIXI.Container; radiusGraphic: PIXI.Graphics };
  } = {};
  debug = true;

  init(entity: number, gameModel: GameModel, viewport: Viewport) {
    const container = new PIXI.Container();
    container.zIndex = 100;

    RadiusSchema.id = entity;
    const radius = RadiusSchema.radius;
    const radiusGraphic = new PIXI.Graphics();
    radiusGraphic.lineStyle(5, 0xff0000);
    radiusGraphic.drawCircle(0, 0, radius);

    container.addChild(radiusGraphic as any);
    container.zIndex = 100000;

    const entityObj: any = {
      container,
      radiusGraphic,
    };

    viewport.addChild(container as any);
    this.entities[entity] = entityObj;
    this.ids.add(entity);
  }

  run(entity: number, gameModel: GameModel) {
    const transformSchema = gameModel.getTyped(entity, TransformSchema);
    const entityPosition = transformSchema.position;
    const container = this.entities[entity].container;
    container.position.set(entityPosition.x, entityPosition.y);
  }

  cleanup(entity: number) {
    if (!this.entities[entity]) {
      return;
    }
    const container = this.entities[entity].container;
    container.children.forEach((child) => {
      container.removeChild(child);
      child.destroy();
    });

    container.destroy();
    delete this.entities[entity];
    this.ids.delete(entity);
  }
}

registerPixiComponent("Radius", DebugRadiusDraw);
