import type { ComponentData } from "../components/types";
import { EnemyTypeEnum, EntityType } from "../constants/enums";
import { componentRegistered } from "@/components/ComponentRegistry";
import type { GameModel } from "@/game/GameModel";
import { clone } from "@/utils/clone";
import { StringToEnum } from "@/utils/typehelpers";
import * as enums from "@/constants/enums";
import AssetLoader from "@/loader/AssetLoader";
import type { Random } from "@/utils/rand";
import { generate } from "@/utils/rand";
import toposort from "toposort";
import { ChildSchema } from "@/schemas/entity/Child";
import { EntityAsset } from "./EntityAssets";
import { assignGlobalSingleton, getGlobalSingleton, setGlobalSingleton } from "@/global";
import { cloneDeep } from "lodash";
import { hexToRgbNumber } from "@/utils/colors";
import { ParentSchema } from "@/schemas/entity/Parent";
import { ListenEntityCreationSchema, ListenEntityCreationSystem } from "@/components/core/ListenEntityCreation";

export interface EntityDefinition {
  name: string;
  type?: string;
  children?: string[];
  components?: ComponentData[];
  inherits?: string[] | string;
}

export type FlexibleEntityDefinition = EntityDefinition & {
  components?: (ComponentData | string)[];
  assets?: EntityAsset[];
};

export type EntityComponentDTO = {
  children?: EntityComponentDTO[];
  components: ComponentData[];
};

export class EntityFactory {
  entityDefinitionMap = new Map<string, EntityDefinition>();
  entityDefinitionStringMap = new Map<string, string>();

  constructor(entityDefinitions: FlexibleEntityDefinition[]) {
    console.log("entity factory constructor!");

    let list = entityDefinitions.slice();
    let inheritanceFailureCount = 0;
    let inheritanceList: FlexibleEntityDefinition[] = [];
    while (list.length && inheritanceFailureCount++ < 100) {
      inheritanceList = [];
      list.forEach((entityDefinition) => {
        if (entityDefinition.inherits) {
          let parentLoaded = true;
          // check if the parent is already loaded
          if (typeof entityDefinition.inherits === "string") {
            if (!this.entityDefinitionMap.has(entityDefinition.inherits.toLowerCase())) {
              inheritanceList.push(entityDefinition);
              parentLoaded = false;
            }
          } else {
            entityDefinition.inherits.every((x) => {
              if (!this.entityDefinitionMap.has(x.toLowerCase())) {
                inheritanceList.push(entityDefinition);
                parentLoaded = false;
                return false;
              }
              return true;
            });
          }
          if (!parentLoaded) {
            return;
          }
        }

        this.entityDefinitionMap.set(entityDefinition.name.toLowerCase(), JSON.parse(JSON.stringify(entityDefinition)));
      });
      list = inheritanceList;
    }
    if (inheritanceFailureCount >= 100) {
      console.error(inheritanceList.map((x) => x.name));
      throw new Error("Inheritance failure count exceeded 100!");
    }
    const definitions = Array.from(this.entityDefinitionMap.values());

    definitions.forEach((x: FlexibleEntityDefinition) => {
      let inherits;
      x.components = (x.components || []).map((c) => {
        return typeof c === "string" ? { type: c } : c;
      });
      if (x.assets) {
        x.assets.forEach((asset) => {
          switch (asset.type) {
            case "image":
              AssetLoader.getInstance().loadImage(asset.key, asset.url);
              break;
            case "spritesheet": {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { key, url, type, ...spriteOptions } = asset;
              AssetLoader.getInstance().loadSprite(key, url, spriteOptions);
              break;
            }
            case "sound": {
              // eslint-disable-next-line @typescript-eslint/no-unused-vars
              const { key, url, type, ...soundOptions } = asset;
              AssetLoader.getInstance().loadSound(key, url, soundOptions);
              break;
            }
            case "spine":
              AssetLoader.getInstance().loadSpine(asset.key, asset.url);
              break;
            case "map":
              AssetLoader.getInstance().loadMap(asset.key, asset.url);
              break;
            case "mapskin":
              AssetLoader.getInstance().loadMapSkin(asset.key, asset.url);
              break;
          }
        });
      }
      if (x.inherits) {
        if (typeof x.inherits === "string") {
          inherits = [x.inherits];
        } else {
          inherits = x.inherits;
        }
      }
      if (inherits) {
        inherits.forEach((inheritable) => {
          const toInherit = this.entityDefinitionMap.get(inheritable.toLowerCase());
          if (!toInherit) {
            console.error(`Could not find inheritable ${inheritable} in map!`);
            return;
          } else {
            // console.log(`Found inheritable ${inheritable} for definition ${x.name}`);
          }
          const definitionCopy = JSON.parse(JSON.stringify(x));
          definitionCopy.type = definitionCopy.type ?? toInherit.type;
          definitionCopy.children = [...(toInherit.children ?? []), ...(definitionCopy.children ?? [])];
          if (
            toInherit.components &&
            toInherit.components.length > 0 &&
            definitionCopy.components &&
            definitionCopy.components.length > 0
          ) {
            definitionCopy.components = Object.values(
              clone(toInherit.components)
                .concat(definitionCopy.components)
                .reduce((acc: any, x: any) => {
                  return { ...acc, [x.type]: x };
                }, {})
            );
          } else if (toInherit.components && toInherit.components.length > 0) {
            definitionCopy.components = clone(toInherit.components);
          } else {
            // definitionCopy.components = [];
          }
          this.entityDefinitionMap.set(x.name.toLowerCase(), definitionCopy);
        });
      }
    });

    const finalDefinitions = Array.from(this.entityDefinitionMap.values());

    finalDefinitions.forEach((x) => {
      this.entityDefinitionStringMap.set(x.name.toLowerCase(), JSON.stringify(x));
    });

    setGlobalSingleton("EntityFactory", this);
  }

  static configureEntityFactory(entityDefinitions: FlexibleEntityDefinition[]) {
    new EntityFactory(entityDefinitions);
  }

  static getInstance(): EntityFactory {
    return getGlobalSingleton("EntityFactory");
  }

  mapComplexValues(data: any, gameModel: GameModel): any {
    if (Array.isArray(data)) {
      return data.map((d) => this.mapComplexValues(d, gameModel));
    } else if (typeof data === "object") {
      for (const key in data) {
        data[key] = this.mapComplexValues(data[key], gameModel);
      }
    } else if (typeof data === "string") {
      if (data === "self:") {
        return gameModel.getNextEntityId(); // this is broken with children
      }
      if (data.includes("::self::")) {
        const [prefix, suffix] = data.split("::self::");
        return prefix + gameModel.getNextEntityId() + suffix;
      }
      if (data.startsWith("enum:")) {
        const enumClassName = data.substring(5).split(".");
        // @ts-ignore
        return StringToEnum<any>(enumClassName[1], enums[enumClassName[0]]);
      }
      if (data.includes("::enum::")) {
        const enumClassName = data.substring(5).split(".");
        const [prefix, suffix] = data.split("::enum::");
        // @ts-ignore
        return prefix + StringToEnum<any>(enumClassName[1], enums[enumClassName[0]]) + suffix;
      }
      if (data.startsWith("rgb:")) {
        return hexToRgbNumber(data.substring(4));
      }
      if (data.startsWith("rand:")) {
        const randValue = gameModel.rand.number();
        const [min, max] = data.substring("rand:".length).split(":");
        if (min) {
          if (max) {
            return randValue * (parseInt(max) - parseInt(min)) + parseInt(min);
          }
          return randValue * parseInt(min);
        }
        return randValue;
      } else if (data.startsWith("randint:")) {
        const [min, max] = data.substring("randint:".length).split(":");

        const randValue = gameModel.rand.int(parseInt(min), max ? parseInt(max) : undefined);
        return randValue;
      } else if (data.startsWith("randdzint:")) {
        const [min, max] = data.substring("randdzint:".length).split(":");
        const randValue =
          gameModel.rand.int(parseInt(min), max ? parseInt(max) : undefined) * (gameModel.rand.number() > 0.5 ? 1 : -1);
        return randValue;
      } else if (data.startsWith("playercount:")) {
        const [multiplier] = data.substring("playercount:".length).split(":");
        return Math.max(gameModel.players.length, 0) * (multiplier ? parseInt(multiplier) : 1);
      } else {
        return data;
      }
    }
    return data;
  }

  getEntityType = (entityName: string): EntityType => {
    try {
      const entityType = StringToEnum<EntityType>(
        this.entityDefinitionMap.get(entityName.toLowerCase())?.type || "",
        EntityType
      );
      if (!entityType) {
        throw new Error(`Could not find entity type for ${entityName}`);
      }
      return entityType;
    } catch (e) {
      console.error(entityName);
      console.error(e);
      throw e;
    }
  };

  findEntitiesWithComponent = (componentName: string | string[]): string[] => {
    const entities: string[] = [];
    if (!Array.isArray(componentName)) {
      componentName = [componentName];
    }
    this.entityDefinitionMap.forEach((entityDefinition, entityName) => {
      if (
        (componentName as string[]).every((c) => entityDefinition.components?.some((component) => component.type === c))
      ) {
        entities.push(entityName);
      }
    });
    return entities;
  };

  getComponentFromEntity = (entityName: string, componentName: string, clone = false): ComponentData | undefined => {
    const entityDefinition = this.entityDefinitionMap.get(entityName.toLowerCase());
    const component = entityDefinition?.components?.find((c) => c.type === componentName);
    if (component && clone) {
      return cloneDeep(component);
    }
    return component;
  };

  getEntityDefinition = (entityName: string, gameModel?: GameModel): EntityDefinition => {
    let entityDefinition: Partial<EntityDefinition> = JSON.parse(
      this.entityDefinitionStringMap.get(entityName.toLowerCase()) || "{}"
    );
    if (!entityDefinition.name) {
      entityDefinition.name = entityName;
    }

    if (gameModel) {
      entityDefinition = this.mapComplexValues(entityDefinition, gameModel) as EntityDefinition;
    }

    return entityDefinition as EntityDefinition;
  };

  cache: any = {};

  mapEntityComponent(
    gameModel: GameModel,
    entityName: string,
    componentOverrides?: { [key: string]: any }
  ): EntityComponentDTO {
    const entityDefinition = this.getEntityDefinition(entityName, gameModel);
    const entityComponents = this.generateComponents(entityDefinition);

    if (componentOverrides) {
      entityComponents.components.forEach((c, i) => {
        if (componentOverrides[c.type]) {
          if (typeof componentOverrides[c.type] === "function") {
            entityComponents.components[i] = {
              ...c,
              ...componentOverrides[c.type](c),
            };
          } else {
            entityComponents.components[i] = {
              ...c,
              ...componentOverrides[c.type],
            };
          }
        }
      });
    }

    const dependencyOrder = [];
    const graphList: [string, string][] = [];
    const dependencyDict: { [key: string]: ComponentData } = {};
    entityComponents.components.forEach((c) => {
      dependencyDict[c.type] = c;
      const dependencies = gameModel.getDependencies(c.type);
      if (!dependencies.length) {
        dependencyOrder.push(c.type);
      } else {
        for (let i = 0; i < dependencies.length; i++) {
          graphList.push([c.type, dependencies[i]]);
        }
      }
    });

    dependencyOrder.push(...toposort(graphList).reverse());

    const finalComponentList: ComponentData[] = [];
    dependencyOrder.forEach((c) => {
      if (dependencyDict[c]) {
        finalComponentList.push(dependencyDict[c]);
      }
    });
    entityComponents.components = finalComponentList;

    if (entityDefinition.children) {
      entityComponents.children = entityDefinition.children.map((childName) => {
        return this.mapEntityComponent(gameModel, childName);
      });
    }

    return entityComponents;
  }

  createEntity(gameModel: GameModel, entity: EntityComponentDTO): number {
    const entityId = gameModel.addEntity();
    this.addComponents(gameModel, entityId, entity.components);
    gameModel.removeComponent(entityId, "Parent");

    entity.children?.forEach((child: EntityComponentDTO) => {
      const childId = this.createEntity(gameModel, child);
      if (gameModel.hasComponent(childId, "Child")) {
        const childData = gameModel.getTypedUnsafe(childId, ChildSchema);
        childData.parent = entityId;
      } else {
        gameModel.setComponent(childId, "Child", { parent: entityId });
      }
      if (gameModel.hasComponent(entityId, "Parent")) {
        const parentData = gameModel.getTypedUnsafe(entityId, ParentSchema);
        parentData.children.push(childId);
      } else {
        gameModel.setComponent(entityId, "Parent", { children: [childId] });
      }
      if (!gameModel.hasComponent(childId, "Transform")) {
        gameModel.setComponent(childId, "Transform", {
          x: 0,
          y: 0,
        });
      }
    });
    return entityId;
  }

  hasEntity = (entityName: string): boolean => {
    return this.entityDefinitionMap.has(entityName.toLowerCase());
  };

  generateEntity = (gameModel: GameModel, entityName: string, componentOverrides?: { [key: string]: any }): number => {
    try {
      const entityComponents = this.mapEntityComponent(gameModel, entityName, componentOverrides);
      const createdEntity = this.createEntity(gameModel, entityComponents);

      if (entityName !== "core" && gameModel.hasComponent(gameModel.coreEntity, ListenEntityCreationSchema)) {
        gameModel.getTypedUnsafe(gameModel.coreEntity, ListenEntityCreationSchema).entity = createdEntity;
        gameModel.getSystem(ListenEntityCreationSystem).run(gameModel.coreEntity, gameModel);
      }
      return createdEntity;
    } catch (e) {
      console.error(entityName, componentOverrides);
      console.error(e);
      throw e;
    }
  };

  addComponents(gameModel: GameModel, entity: number, components: ComponentData[]) {
    components.forEach((component) => {
      try {
        if (component.enabled === false) return;
        if (componentRegistered(component.type)) {
          gameModel.setComponent(entity, component.type, component.data ?? component);
          return;
        }
        console.warn("Component not registered: " + component.type);
      } catch (e) {
        console.error(component, components);
        console.error(e);
        throw e;
      }
    });
  }

  generateComponents = (definition: EntityDefinition): EntityComponentDTO => {
    const components: ComponentData[] = definition.components ?? [];

    const type = StringToEnum<EntityType>(definition.type, EntityType) ?? EntityType.ENTITY;

    const mapComponent = (name: string, data: any) => {
      const component = {
        type: name,
        data: data,
      };
      if (!components.find((c) => c.type === name)) {
        components.push(component);
      }
    };

    if (type === EntityType.PLAYER) {
      mapComponent("EntityType", { type: "EntityType", entityType: EntityType.ALLY });
    } else {
      mapComponent("EntityType", { type: "EntityType", entityType: type });
    }

    mapComponent("Description", {
      type: "Description",
      description: definition.name,
    });

    switch (type) {
      case EntityType.PLAYER:
        mapComponent("PlayerType", { type: "PlayerType" });
        mapComponent("AllyType", { type: "AllyType" });
        break;
      case EntityType.ALLY:
        mapComponent("AllyType", { type: "AllyType" });
        break;
      case EntityType.ENEMY: {
        const enemyType = EnemyTypeEnum.U_DEF;
        mapComponent("EnemyType", {
          type: "EnemyType",
          enemyType: enemyType,
        });
        break;
      }
      case EntityType.ALTAR:
        mapComponent("AltarType", { type: "AltarType" });
        break;
      case EntityType.PICKUP:
        mapComponent("PickupType", { type: "PickupType" });
        break;
      case EntityType.PROJECTILE:
        mapComponent("ProjectileType", { type: "ProjectileType" });
        break;
      case EntityType.INTERACTABLE:
        mapComponent("InteractableType", { type: "InteractableType" });
        break;
      case EntityType.WALL:
        mapComponent("WallType", { type: "WallType" });
        break;
      case EntityType.DOOR:
        mapComponent("DoorType", { type: "DoorType" });
        break;
      case EntityType.WEAPON:
        // mapComponent("WeaponType", { type: "WeaponType" });
        break;
    }

    return {
      components: components,
      children: [],
    };
  };
}
