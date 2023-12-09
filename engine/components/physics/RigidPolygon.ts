import type { System } from "@/components/System";
import type { GameModel } from "@/game/GameModel";
import { ComponentCategory } from "../../components/types";
import { DEPTHS, registerSystem } from "../../components/ComponentRegistry";
import { addVector2d } from "@/utils/vector";

import { toWorldSpace } from "@/utils/isometric";
import { TransformSchema } from "@/schemas/entity/Transform";
import { RigidPolygonSchema } from "@/schemas/physics/RigidPolygon";

export class RigidPolygonSystem implements System {
  type = "RigidPolygon";
  category: ComponentCategory = ComponentCategory.PHYSICS;
  schema = RigidPolygonSchema;
  depth = DEPTHS.COLLISION - 0.0001;

  init(entity: number, gameModel: GameModel) {
    const transformSchema = gameModel.getTyped(entity, TransformSchema);

    const rigidPolygon = gameModel.getTyped(entity, RigidPolygonSchema);

    const set = [];
    if (rigidPolygon.vertexIndicies.length !== 0) {
      for (let i = 0; i < rigidPolygon.vertexIndicies.length; i++) {
        const offset = rigidPolygon.vertexIndicies[i];
        const nextOffset = rigidPolygon.vertexIndicies[i + 1] || 0;
        const positionOffset = rigidPolygon.vertexOffsets[i] || { x: 0, y: 0 };

        const vertices = rigidPolygon.vertices.slice(offset, nextOffset || undefined).map((v) => {
          return toWorldSpace(addVector2d(v, positionOffset));
        });
        set.push(vertices);
      }
    } else {
      set.push(rigidPolygon.vertices);
    }

    // rigidPolygon.bodyId = body.id;
    // this.bodies[entity] = body;
  }

  runAll?(gameModel: GameModel): void {
    const entities = gameModel.getComponentActives("RigidPolygon");

    for (let i = 0; i < entities.length; i++) {
      const entity = entities[i];
    }
  }

  cleanup(entity: number, gameModel: GameModel) {
    // noop
  }
}

registerSystem(RigidPolygonSystem);
