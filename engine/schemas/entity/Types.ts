import { EnemyTypeEnum, EntityType as EntityTypeEnum, WeaponTypeEnum } from "yage/constants/enums";
import { Component, defaultValue, Schema, type } from "minecs";
import { ComponentCategory } from "yage/systems/types";

@Component(ComponentCategory.TYPE)
export class EntityType extends Schema {
  @type(EntityTypeEnum)
  @defaultValue(EntityTypeEnum.ENTITY)
  entityType: EntityType;
}

@Component(ComponentCategory.TYPE)
export class WeaponType extends Schema {
  @type(WeaponTypeEnum)
  @defaultValue(WeaponTypeEnum.NONE)
  weaponType: WeaponTypeEnum;
}

@Component(ComponentCategory.TYPE)
export class EnemyType extends Schema {
  @type("number")
  @defaultValue(EnemyTypeEnum.U_DEF)
  enemyType: EnemyTypeEnum;
}

@Component(ComponentCategory.TYPE)
export class PlayerType extends Schema {}

@Component(ComponentCategory.TYPE)
export class AllyType extends Schema {}

@Component(ComponentCategory.TYPE)
export class PickupType extends Schema {}

@Component(ComponentCategory.TYPE)
export class ProjectileType extends Schema {}

@Component(ComponentCategory.TYPE)
export class WallType extends Schema {}

@Component(ComponentCategory.TYPE)
export class AltarType extends Schema {}

@Component(ComponentCategory.TYPE)
export class InteractableType extends Schema {}

@Component(ComponentCategory.TYPE)
export class DoorType extends Schema {}

@Component(ComponentCategory.TYPE)
export class AuraType extends Schema {
  @type("number")
  @defaultValue(0)
  spawnTime: number;
}

@Component(ComponentCategory.TYPE)
export class MapEntityType extends Schema {
  @type("number")
  @defaultValue(0)
  width: number;

  @type("number")
  @defaultValue(0)
  height: number;
}
