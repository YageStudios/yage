import { EntityType } from "@/constants/enums";
import { Component, Schema, type } from "@/decorators/type";
import type { SpatialMap } from "@/utils/Collision";

@Component("SpatialMap")
export class SpatialMapSchema extends Schema {
  @type("object")
  spatialMap: SpatialMap<number>;

  @type("object")
  [EntityType.INTERACTABLE]: SpatialMap<number>;

  @type("object")
  [EntityType.ENEMY]: SpatialMap<number>;

  @type("object")
  [EntityType.PICKUP]: SpatialMap<number>;

  @type("object")
  [EntityType.ALLY]: SpatialMap<number>;

  @type("object")
  [EntityType.PROJECTILE]: SpatialMap<number>;

  @type("object")
  [EntityType.WALL]: SpatialMap<number>;

  @type("object")
  [EntityType.WEAPON]: SpatialMap<number>;

  @type("object")
  pointSets: { [eid: number]: Set<string> };
}
