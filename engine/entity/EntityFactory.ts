import type { ComponentData } from "../systems/types";
import { EnemyTypeEnum, EntityTypeEnum } from "../constants/enums";
import type { GameModel } from "yage/game/GameModel";
import { clone } from "yage/utils/clone";
import { StringToEnum } from "yage/utils/typehelpers";
import { getEnum } from "yage/constants/";
import AssetLoader from "yage/loader/AssetLoader";
import type { EntityAsset } from "./EntityAssets";
import { getGlobalSingleton, setGlobalSingleton } from "yage/global";
import { cloneDeep } from "lodash";
import { hexToRgbNumber } from "yage/utils/colors";
import { Parent } from "yage/schemas/entity/Parent";
import { ListenEntityCreationSystem } from "yage/systems/core/ListenEntityCreation";
import { ListenEntityCreation } from "yage/schemas/core/ListenEntityCreation";
import { componentList } from "minecs";
import toposort from "toposort";
import { flags } from "yage/console/flags";

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
            case "ui":
              AssetLoader.getInstance().loadUi(asset.key, asset.url);
              break;
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
        const mappedkey = this.mapComplexValues(key, gameModel).toString();
        data[mappedkey] = this.mapComplexValues(data[key], gameModel);
        if (mappedkey !== key) {
          delete data[key];
        }
      }
    } else if (typeof data === "string") {
      if (data.startsWith("enum:")) {
        const enumClassName = data.substring(5).split(".");
        // @ts-ignore
        return StringToEnum<any>(enumClassName[1], getEnum(enumClassName[0]));
      }
      if (data.includes("::enum::")) {
        const enumClassName = data.substring(5).split(".");
        const [prefix, suffix] = data.split("::enum::");
        // @ts-ignore
        return prefix + StringToEnum<any>(enumClassName[1], getEnum(enumClassName[0])) + suffix;
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

  getEntityType = (entityName: string): EntityTypeEnum => {
    try {
      const entityType = StringToEnum<EntityTypeEnum>(
        this.entityDefinitionMap.get(entityName.toLowerCase())?.type || "",
        EntityTypeEnum
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

  findEntityDefinitionsWithComponent = (componentName: string | string[]): EntityDefinition[] => {
    const entities: EntityDefinition[] = [];
    if (!Array.isArray(componentName)) {
      componentName = [componentName];
    }
    this.entityDefinitionMap.forEach((entityDefinition, entityName) => {
      if (
        (componentName as string[]).every((c) => entityDefinition.components?.some((component) => component.type === c))
      ) {
        entities.push(entityDefinition);
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
    if (!this.entityDefinitionStringMap.has(entityName.toLowerCase())) {
      console.warn(`Could not find entity definition for ${entityName}`);
    }
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
      const overrideKeys = Object.keys(componentOverrides);
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
          overrideKeys.splice(overrideKeys.indexOf(c.type), 1);
        }
      });
      if (flags.DEBUG && overrideKeys.length) {
        console.warn("Unused overrides: ", overrideKeys, entityName);
      }
    }

    const dependencyOrder = [];
    const graphList: [string, string][] = [];
    const dependencyDict: { [key: string]: ComponentData } = {};
    entityComponents.components.forEach((c) => {
      dependencyDict[c.type] = c;
      const systems = gameModel.getSystemsByType(c.type) as { dependencies?: string[] }[];
      const dependencies = systems
        .flat()
        .flatMap((s) => s.dependencies)
        .filter((d) => d && d !== c.type) as string[];
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

    entity.children?.forEach((child: EntityComponentDTO) => {
      const childComponent = child.components.find((c) => c.type === "Child");

      if (!child.components.find((c) => c.type === "Transform")) {
        child.components.push({ type: "Transform", data: { x: 0, y: 0 } });
      }

      if (!childComponent) {
        child.components.push({ type: "Child", data: { parent: entityId } });
      } else {
        if (childComponent.data) {
          childComponent.data.parent = entityId;
        } else {
          childComponent.parent = entityId;
        }
      }
      this.createEntity(gameModel, child);
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

      if (entityName !== "core" && gameModel.hasComponent(ListenEntityCreation, gameModel.coreEntity)) {
        gameModel.getTypedUnsafe(ListenEntityCreation, gameModel.coreEntity).entity = createdEntity;
        gameModel.getSystem(ListenEntityCreationSystem).run(gameModel, gameModel.coreEntity);
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
        if (componentList.find((c) => c.type === component.type)) {
          gameModel.addComponent(component.type, entity, component.data ?? component);
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

    const type = StringToEnum<EntityTypeEnum>(definition.type, EntityTypeEnum) ?? EntityTypeEnum.ENTITY;

    const mapComponent = (name: string, data: any) => {
      const component = {
        type: name,
        data: data,
      };
      if (!components.find((c) => c.type === name)) {
        components.push(component);
      }
    };

    if (type === EntityTypeEnum.PLAYER) {
      mapComponent("EntityType", { type: "EntityType", entityType: EntityTypeEnum.ALLY });
    } else {
      mapComponent("EntityType", { type: "EntityType", entityType: type });
    }

    mapComponent("Description", {
      type: "Description",
      description: definition.name,
    });

    switch (type) {
      case EntityTypeEnum.PLAYER:
        mapComponent("PlayerType", { type: "PlayerType" });
        mapComponent("AllyType", { type: "AllyType" });
        break;
      case EntityTypeEnum.ALLY:
        mapComponent("AllyType", { type: "AllyType" });
        break;
      case EntityTypeEnum.ENEMY: {
        const enemyType = EnemyTypeEnum.U_DEF;
        mapComponent("EnemyType", {
          type: "EnemyType",
          enemyType: enemyType,
        });
        break;
      }
      case EntityTypeEnum.ALTAR:
        mapComponent("AltarType", { type: "AltarType" });
        break;
      case EntityTypeEnum.PICKUP:
        mapComponent("PickupType", { type: "PickupType" });
        break;
      case EntityTypeEnum.PROJECTILE:
        mapComponent("ProjectileType", { type: "ProjectileType" });
        break;
      case EntityTypeEnum.INTERACTABLE:
        mapComponent("InteractableType", { type: "InteractableType" });
        break;
      case EntityTypeEnum.WALL:
        mapComponent("WallType", { type: "WallType" });
        break;
      case EntityTypeEnum.DOOR:
        mapComponent("DoorType", { type: "DoorType" });
        break;
      case EntityTypeEnum.WEAPON:
        // mapComponent("WeaponType", { type: "WeaponType" });
        break;
    }

    return {
      components: components,
      children: [],
    };
  };
}
