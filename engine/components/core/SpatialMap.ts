import { EntityType } from "@/constants/enums";
import { DEPTHS, registerSystem } from "@/components/ComponentRegistry";
import type { GameModel } from "@/game/GameModel";
import { spatialMap } from "@/utils/Collision";
import type { System } from "../System";
import { ComponentCategory } from "../types";
import { SpatialMapSchema } from "@/schemas/core/SpatialMap";

export const SPATIAL_MAP_CELL_SIZE = 100;

class SpatialMapSystem implements System {
  type = "SpatialMap";
  category: ComponentCategory = ComponentCategory.BEHAVIOR;

  schema = SpatialMapSchema;
  depth = DEPTHS.COLLISION - 0.000001;

  run(entity: number, gameModel: GameModel) {
    const spatialMapData = gameModel.getTyped(entity, SpatialMapSchema);
    spatialMapData.pointSets = {};
    spatialMapData.spatialMap = spatialMap(
      gameModel,
      gameModel.getComponentActives("Transform"),
      SPATIAL_MAP_CELL_SIZE,
      spatialMapData.pointSets
    );

    spatialMapData[EntityType.INTERACTABLE] = spatialMap(
      gameModel,
      gameModel.getComponentActives("InteractableType"),
      SPATIAL_MAP_CELL_SIZE,
      spatialMapData.pointSets
    );
    spatialMapData[EntityType.ENEMY] = spatialMap(
      gameModel,
      gameModel.getComponentActives("EnemyType"),
      SPATIAL_MAP_CELL_SIZE,
      spatialMapData.pointSets
    );
    spatialMapData[EntityType.PICKUP] = spatialMap(
      gameModel,
      gameModel.getComponentActives("PickupType"),
      SPATIAL_MAP_CELL_SIZE,
      spatialMapData.pointSets
    );
    spatialMapData[EntityType.ALLY] = spatialMap(
      gameModel,
      gameModel.getComponentActives("PlayerType"),
      SPATIAL_MAP_CELL_SIZE,
      spatialMapData.pointSets
    );
    spatialMapData[EntityType.PROJECTILE] = spatialMap(
      gameModel,
      gameModel.getComponentActives("ProjectileType"),
      SPATIAL_MAP_CELL_SIZE,
      spatialMapData.pointSets
    );
    spatialMapData[EntityType.WALL] = spatialMap(
      gameModel,
      gameModel.getComponentActives("WallType"),
      SPATIAL_MAP_CELL_SIZE,
      spatialMapData.pointSets
    );
    spatialMapData[EntityType.WEAPON] = spatialMap(
      gameModel,
      gameModel.getComponentActives("WeaponType"),
      SPATIAL_MAP_CELL_SIZE,
      spatialMapData.pointSets
    );
  }
}

registerSystem(SpatialMapSystem);
