import type { ComponentData } from "../systems/types";
import { isEntityHotReloadEnabled, queueEntityDefaultsPatch, setEntityReloadHandler } from "../dev/hotReload";
import { applyEntityDefaults, trackEntityTemplate } from "./hotDefaults";
import { EntityTypeEnum } from "../constants/enums";
import type { GameModel } from "yage/game/GameModel";
import { StringToEnum } from "yage/utils/typehelpers";
import { getEnum } from "yage/constants/";
import AssetLoader from "yage/loader/AssetLoader";
import type { EntityAsset } from "./EntityAssets";
import { getGlobalSingleton, setGlobalSingleton } from "yage/global";
import { cloneDeep } from "lodash";
import { ListenEntityCreationSystem } from "yage/systems/core/ListenEntityCreation";
import { ListenEntityCreation } from "yage/schemas/core/ListenEntityCreation";
import { componentList } from "minecs";
import { flags } from "yage/console/flags";
import {
  EntityDefinitionRegistry,
  mapDefinitionValues,
  orderComponents,
  yageTypeComponents,
  type EntityDefinition,
  type FlexibleEntityDefinition as CoreFlexibleEntityDefinition,
} from "./definitions";

export type { EntityDefinition } from "./definitions";

export type FlexibleEntityDefinition = CoreFlexibleEntityDefinition<EntityAsset>;

export type EntityComponentDTO = {
  template?: string;
  children?: EntityComponentDTO[];
  components: ComponentData[];
};

const loadAssets = (assets: EntityAsset[]) => {
  assets.forEach((asset) => {
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
};

/**
 * GameModel-facing wrapper over the pure definitions core (yage/entity/definitions): adds asset
 * loading, the global singleton, hot reload and GameModel-driven value mapping and ordering.
 */
export class EntityFactory {
  readonly registry: EntityDefinitionRegistry;
  entityDefinitionMap: Map<string, EntityDefinition>;
  entityDefinitionStringMap = new Map<string, string>();

  constructor(entityDefinitions: FlexibleEntityDefinition[]) {
    this.registry = new EntityDefinitionRegistry(entityDefinitions, { enums: (name) => getEnum(name) as any });
    this.entityDefinitionMap = this.registry.definitions;
    entityDefinitions.forEach((definition) => {
      if (definition.assets) loadAssets(definition.assets);
    });
    this.entityDefinitionMap.forEach((x, key) => {
      this.entityDefinitionStringMap.set(key, JSON.stringify(x));
    });

    setGlobalSingleton("EntityFactory", this);
  }

  static configureEntityFactory(entityDefinitions: FlexibleEntityDefinition[]) {
    new EntityFactory(entityDefinitions);
    setEntityReloadHandler((value) => {
      const definition = value as FlexibleEntityDefinition;
      const index = entityDefinitions.findIndex(
        (entry) => entry.name === definition.name
      );
      if (index < 0)
        throw new Error(
          "Hot reload cannot rename an entity definition. Reload the page."
        );
      const updated = entityDefinitions.slice();
      updated[index] = definition;
      const previous = EntityFactory.getInstance();
      EntityFactory.configureEntityFactory(updated);
      const next = EntityFactory.getInstance();
      queueEntityDefaultsPatch(world => applyEntityDefaults(world, previous, next));
    });
  }

  static getInstance(): EntityFactory {
    return getGlobalSingleton("EntityFactory");
  }

  mapComplexValues(data: any, gameModel: GameModel): any {
    return mapDefinitionValues(data, {
      rand: gameModel.rand,
      enums: (name) => getEnum(name) as any,
      playerCount: gameModel.players?.length ?? 0,
    });
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
    if (isEntityHotReloadEnabled()) entityComponents.template = entityName;

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

    const finalComponentList = orderComponents(entityComponents.components, (type) =>
      (gameModel.getSystemsByType(type) as unknown as { dependencies?: string[] }[])
        .flat()
        .flatMap((s) => s.dependencies ?? [])
    );
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
    if (entity.template) trackEntityTemplate(gameModel, entityId, entity.template);

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
    for (const implicit of yageTypeComponents(definition)) {
      if (!components.find((c) => c.type === implicit.type)) components.push(implicit);
    }
    return {
      components: components,
      children: [],
    };
  };
}
