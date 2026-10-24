import { EnemyTypeEnum, EntityTypeEnum } from "../../constants/enums";
import type { ComponentData, EntityDefinition } from "./types";
import { enumValue } from "./values";

/** The definition's `type` as an EntityTypeEnum (ENTITY when absent or unknown). */
export const entityTypeOf = (definition: EntityDefinition): EntityTypeEnum => {
  if (definition.type === undefined) return EntityTypeEnum.ENTITY;
  const value = enumValue(EntityTypeEnum as unknown as Record<string, unknown>, definition.type);
  return (typeof value === "number" ? value : EntityTypeEnum.ENTITY) as EntityTypeEnum;
};

/**
 * The components yage's EntityFactory adds for every definition: EntityType, Description and the
 * type tag (PlayerType, EnemyType, ...). Lean worlds without those schemas simply do not pass this.
 */
export const yageTypeComponents = (definition: EntityDefinition): ComponentData[] => {
  const type = entityTypeOf(definition);
  const out: ComponentData[] = [
    { type: "EntityType", data: { type: "EntityType", entityType: type === EntityTypeEnum.PLAYER ? EntityTypeEnum.ALLY : type } },
    { type: "Description", data: { type: "Description", description: definition.name } },
  ];
  const tag = (name: string, extra: Record<string, unknown> = {}) => out.push({ type: name, data: { type: name, ...extra } });
  switch (type) {
    case EntityTypeEnum.PLAYER:
      tag("PlayerType");
      tag("AllyType");
      break;
    case EntityTypeEnum.ALLY:
      tag("AllyType");
      break;
    case EntityTypeEnum.ENEMY:
      tag("EnemyType", { enemyType: EnemyTypeEnum.U_DEF });
      break;
    case EntityTypeEnum.ALTAR:
      tag("AltarType");
      break;
    case EntityTypeEnum.PICKUP:
      tag("PickupType");
      break;
    case EntityTypeEnum.PROJECTILE:
      tag("ProjectileType");
      break;
    case EntityTypeEnum.INTERACTABLE:
      tag("InteractableType");
      break;
    case EntityTypeEnum.WALL:
      tag("WallType");
      break;
    case EntityTypeEnum.DOOR:
      tag("DoorType");
      break;
  }
  return out;
};
