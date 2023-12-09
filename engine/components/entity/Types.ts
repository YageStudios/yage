import { EnemyTypeEnum, EntityType, WeaponTypeEnum } from "../../constants/enums";
import { Bitecs, BitecsSchema, Component, defaultValue, Schema, type } from "../../decorators/type";
import { registerSchema } from "@/components/ComponentRegistry";
import { ComponentCategory } from "../types";

@Bitecs()
@Component("EntityType")
export class EntityTypeSchema extends BitecsSchema {
  @type(EntityType)
  @defaultValue(EntityType.ENTITY)
  _entityType: EntityType;

  static get entityType() {
    return EntityTypeSchema.store.entityType[this.id];
  }

  static set entityType(value) {
    EntityTypeSchema.store.entityType[this.id] = value;
    EntityTypeSchema.store.__changes[this.id] |= 1;
  }
}

registerSchema(ComponentCategory.TYPE, EntityTypeSchema);

@Component("WeaponType")
export class WeaponTypeSchema extends Schema {
  @type(WeaponTypeEnum)
  @defaultValue(WeaponTypeEnum.NONE)
  weaponType: WeaponTypeEnum;
}

registerSchema(ComponentCategory.TYPE, WeaponTypeSchema);

@Component("EnemyType")
export class EnemyTypeSchema extends Schema {
  @type("number")
  @defaultValue(EnemyTypeEnum.U_DEF)
  enemyType: EnemyTypeEnum;
}

registerSchema(ComponentCategory.TYPE, EnemyTypeSchema);

@Component("PlayerType")
export class PlayerTypeSchema extends Schema {}

registerSchema(ComponentCategory.TYPE, PlayerTypeSchema);

@Component("AllyType")
export class AllyTypeSchema extends Schema {}

registerSchema(ComponentCategory.TYPE, AllyTypeSchema);

@Component("PickupType")
export class PickupTypeSchema extends Schema {}

registerSchema(ComponentCategory.TYPE, PickupTypeSchema);

@Component("ProjectileType")
export class ProjectileTypeSchema extends Schema {}

registerSchema(ComponentCategory.TYPE, ProjectileTypeSchema);

@Component("WallType")
export class WallTypeSchema extends Schema {}

registerSchema(ComponentCategory.TYPE, WallTypeSchema);

@Component("AltarType")
export class AltarTypeSchema extends Schema {}

registerSchema(ComponentCategory.TYPE, AltarTypeSchema);

@Component("InteractableType")
export class InteractableTypeSchema extends Schema {}

registerSchema(ComponentCategory.TYPE, InteractableTypeSchema);

@Component("DoorType")
export class DoorTypeSchema extends Schema {}

registerSchema(ComponentCategory.TYPE, DoorTypeSchema);

@Component("AuraType")
export class AuraTypeSchema extends Schema {
  @type("number")
  @defaultValue(0)
  spawnTime: number;
}

registerSchema(ComponentCategory.TYPE, AuraTypeSchema);

@Component("MapEntityType")
export class MapEntityTypeSchema extends Schema {
  @type("number")
  @defaultValue(0)
  width: number;

  @type("number")
  @defaultValue(0)
  height: number;
}
registerSchema(ComponentCategory.TYPE, MapEntityTypeSchema);
