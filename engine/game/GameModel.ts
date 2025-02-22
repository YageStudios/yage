import type { Constructor, Schema, SerializedWorld, SystemImpl, WorldComponent } from "minecs";
import {
  addComponent,
  addEntity,
  createWorld,
  defineQuery,
  entityExists,
  getComponentByType,
  hasComponent,
  stepWorld,
  componentList,
  type World,
  getSystemsByType,
  removeComponent,
  getSystem,
  removeEntity,
  stepWorldDraw,
  serializeWorld,
  deserializeWorld,
  SerialMode,
  deleteWorld,
  StringToEnum,
} from "minecs";
import { Random } from "yage/schemas/core/Random";
import type { Random as RandomType } from "yage/utils/rand";
import "yage/systems";
import type { PhysicsSaveState } from "yage/systems/physics/Physics";
import { PhysicsSystem } from "yage/systems/physics/Physics";
import Description from "yage/schemas/core/Description";
import { flags } from "yage/console/flags";
import { EntityFactory } from "yage/entity/EntityFactory";
import { EntityTypeEnum } from "yage/constants/enums";
import { ComponentCategory } from "yage/constants/enums";
import type { ComponentData } from "yage/systems/types";
import { EntityType } from "yage/schemas/entity/Types";
import { Parent } from "yage/schemas/entity/Parent";
import { InputManager } from "yage/inputs/InputManager";
import { PlayerEventManager } from "yage/inputs/PlayerEventManager";
import { ShareOnEject } from "yage/schemas/share/ShareOnEject";
import { DoNotEject } from "yage/schemas/entity/DoNotEject";
import { UiCleanupOnLeave } from "yage/schemas/render/UiCleanupOnLeave";

// @ts-expect-error - MineCS doesn't have a type for this
type EntityWithComponent<T extends Schema> = number & { __hasComponent: T["type"] };

export type GameModelState = {
  core: number;
  timeElapsed: number;
  frame: number;
  world: SerializedWorld | string;
  jsonWorld?: SerializedWorld;
  physics: PhysicsSaveState;
};

export type EjectedEntity = {
  entityType: string | EntityTypeEnum;
  description: string;
  entityId: number;
  components: ComponentData[];
  entities: number[];
  children: { [key: number]: EjectedEntity };
  hasChildren: boolean;
};

export type GameModel = World & {
  inputManager: InputManager;
  roomId: string;
  seed: string;
  ping: number;
  timeElapsed: number;
  rand: RandomType;
  coreEntity: number;
  players: number[];
  paused: boolean;
  destroyed: boolean;
  localNetIds: string[];
  currentWorld: number;
  frameDt: number;
  event: (netId: string, event: string, data: any) => void;
  step: (dt?: number) => void;
  getTypedUnsafe: <T extends Schema>(type: Constructor<T>, entity: number) => T;
  getTyped: {
    <T extends Schema>(type: Constructor<T>, entity: EntityWithComponent<T>): T;
    <T extends Schema>(type: Constructor<T>, entity: number): T | null;
  };
  hasComponent: <T extends Schema>(type: Constructor<T> | string, entity: number) => entity is EntityWithComponent<T>;
  getComponent: <T extends Schema>(type: Constructor<T> | string, entity: number) => T | any | null;
  ejectComponent: <T extends Schema>(type: Constructor<T> | string, entity: number) => ComponentData | null;
  ejectEntity: (entity: number) => EjectedEntity;
  injectEntity: (entity: EjectedEntity) => number;
  addComponent: <T extends Schema>(
    type: Constructor<T> | string,
    entity: number,
    overrides?: Partial<T>,
    reset?: boolean
  ) => void;
  getComponentActives: (type: string | typeof Schema) => number[];
  getCategory: (type: string | typeof Schema) => ComponentCategory;
  getComponentsByCategory: (category: number, entity?: number) => (typeof Schema)[];
  removeComponent: <T extends Schema>(type: Constructor<T> | string, entity: number) => void;
  isActive: (entity: number) => boolean;
  getSystemsByType: (type: string, entity?: number) => SystemImpl<any>[];
  getSystem: <T extends typeof SystemImpl<any>>(system: T) => InstanceType<T>;
  addEntity: () => number;
  removeEntity: (entity: number) => void;
  serializeState: () => GameModelState;
  deserializeState: (state: GameModelState) => Promise<void>;
  destroy: () => void;
  getEntityByDescription: (description: string) => number[] | undefined;
  getEntityByType(type: EntityTypeEnum | EntityTypeEnum[]): number[];
  logEntity: (entity: number, debugOverride?: boolean) => void;
  runGlobalMods: (
    category: ComponentCategory,
    overrides?: {
      [key: string]: any;
    }
  ) => void;
  runMods: (
    entity: number | number[],
    category: ComponentCategory,
    overrides?: {
      [key: string]: any;
    },
    after?: (
      system: SystemImpl<GameModel>,
      components: Schema[],
      overrides: { [key: string]: any },
      isLast: boolean
    ) => void | boolean
  ) => void;
};

export const GameModel = ({
  world = createWorld(1000),
  seed,
  roomId,
  inputManager,
  playerEventManager,
}: {
  world?: World;
  seed?: string;
  roomId: string;
  inputManager: InputManager;
  playerEventManager: PlayerEventManager;
}): GameModel => {
  const componentsByCategory = componentList.reduce((acc, component) => {
    acc[component.category] = acc[component.category] || [];
    acc[component.category].push(component);
    return acc;
  }, {} as Record<number, (typeof Schema)[]>);
  const sortedSystemsByCategory = Object.entries(componentsByCategory).reduce((acc, [category, components]) => {
    acc[parseInt(category)] = components
      .map((component) =>
        getSystemsByType(world, component.type).sort(
          (a, b) => (a.constructor as typeof SystemImpl).depth - (b.constructor as typeof SystemImpl).depth
        )
      )
      .flat()
      .filter((system, index, array) => array.indexOf(system) === index);
    return acc;
  }, {} as Record<number, SystemImpl<any>[]>);

  const sortedSystemsByComponent = componentList.reduce((acc, component) => {
    acc[component.type] = getSystemsByType(world, component.type).sort(
      (a, b) => (a.constructor as typeof SystemImpl).depth - (b.constructor as typeof SystemImpl).depth
    );
    return acc;
  }, {} as Record<string, SystemImpl<any>[]>);

  const componentsBySystem = Object.entries(sortedSystemsByComponent).reduce((acc, [type, systems]) => {
    systems.flat().forEach((system) => {
      acc[system.constructor.name] = acc[system.constructor.name] || [];
      acc[system.constructor.name].push(type);
    });
    return acc;
  }, {} as Record<string, string[]>);

  const gameModel = Object.assign(world, {
    inputManager,
    roomId: roomId ?? "",
    seed: seed ?? "",
    coreEntity: addEntity(world),
    timeElapsed: 0,
    rand: null as any,
    ping: 0,
    frameDt: 16,
    paused: false,
    destroyed: false,
    players: [] as number[],
    localNetIds: [],
    currentWorld: 0,
    getEntityByDescription(description: string): number[] | undefined {
      const entities = this.getComponentActives("Description");
      return entities?.filter((entity) => {
        const desc = this.getTypedUnsafe(Description, entity);
        return desc.description === description;
      });
    },
    getCategory(type: string | typeof Schema): ComponentCategory {
      if (typeof type === "string") {
        const schema = getComponentByType(type);
        if (!schema) {
          return ComponentCategory.NONE;
        }
        return schema.category;
      }
      return type.category;
    },
    getEntityByType(type: EntityTypeEnum | EntityTypeEnum[]): number[] {
      const entities = this.getComponentActives("EntityType");
      return entities?.filter((entity) => {
        const entityType = this.getTypedUnsafe(EntityType, entity);
        if (Array.isArray(type)) {
          return type.includes(entityType.entityType);
        }
        return entityType.entityType === type;
      });
    },
    step: (dt?: number) => {
      gameModel.timeElapsed += dt || 16;
      gameModel.frameDt = dt || 16;
      stepWorld(gameModel);
    },
    stepDraw: () => {
      stepWorldDraw(gameModel);
    },
    addComponent: <T extends Schema>(
      type: Constructor<T> | string,
      entity: number,
      overrides?: Partial<T>,
      reset?: boolean
    ) => {
      if (typeof type === "string") {
        const schema = getComponentByType(type);
        if (!schema) {
          return;
        }
        addComponent(world, schema, entity, overrides, reset);
      } else {
        addComponent(world, type as unknown as typeof Schema, entity, overrides, reset);
      }
    },
    getComponent: <T extends Schema>(type: Constructor<T> | string, entity: number): T | null => {
      if (typeof type === "string") {
        const schema = getComponentByType(type);
        if (!schema) {
          return null;
        }
        return world(schema, entity) as T;
      }
      return world(type, entity);
    },
    getTypedUnsafe: <T extends Schema>(type: Constructor<T>, entity: number) => {
      return world(type, entity);
    },
    getTyped: <T extends Schema>(type: Constructor<T>, entity: number | EntityWithComponent<T>): T | null => {
      if (hasComponent(world, type, entity)) {
        return world(type, entity);
      }
      return null;
    },
    event: (netId: string, event: string, data: any) => {
      playerEventManager.addEvent(netId, `${event}::${JSON.stringify(data)}`);
    },
    injectEntity: (entity: EjectedEntity, entityIdMap: { [eid: number]: number } = {}) => {
      const { entityType, description, components, entities } = entity;

      if (Object.keys(entityIdMap).length === 0) {
        for (let i = 0; i < entities.length; i++) {
          entityIdMap[entities[i]] = addEntity(world);
        }
      }

      const newEntity = entityIdMap[entity.entityId];
      if (entityType) {
        gameModel.addComponent(EntityType, newEntity, { entityType: StringToEnum(entityType, EntityTypeEnum) });
      }
      gameModel.addComponent(Description, newEntity, { description });
      components.forEach((component) => {
        const schema = getComponentByType(component.type);
        if (!schema) {
          return;
        }
        if (schema.entityTypes?.length) {
          for (let i = 0; i < schema.entityTypes.length; i++) {
            const key = schema.entityTypes[i];
            if (component.data[key] !== undefined) {
              if (Array.isArray(component.data[key])) {
                component.data[key] = component.data[key]
                  .map((eid: number) => entityIdMap[eid])
                  .filter((eid: number) => typeof eid === "number");
              } else {
                if (entityIdMap[component.data[key]] === undefined) {
                  delete component.data[key];
                } else {
                  component.data[key] = entityIdMap[component.data[key]];
                }
              }
            }
          }
        }
        console.log("Adding Component", schema.type, newEntity, component.data);
        gameModel.addComponent(component.type, newEntity, component.data);
      });
      if (entity.hasChildren) {
        Object.keys(entity.children).forEach((child) => {
          gameModel.injectEntity(entity.children[child as unknown as number], entityIdMap);
        });
      }
      return newEntity;
    },
    ejectEntity: (entity: number, removeEjectedEntity = true): any => {
      if (removeEjectedEntity) {
        gameModel.runMods(
          gameModel.hasComponent(ShareOnEject, entity)
            ? [...(gameModel.getTyped(ShareOnEject, entity)?.entities ?? [])]
            : [entity],
          ComponentCategory.ON_EJECT,
          {
            owner: entity,
          }
        );
      }

      const data = {
        entityType: gameModel(EntityType).store.entityType[entity],
        description: gameModel.getTypedUnsafe(Description, entity)?.description ?? "",
        entityId: entity,
        components: [],
        entities: [],
        children: {},
        hasChildren: false,
      } as EjectedEntity;
      const children = gameModel.getTypedUnsafe(Parent, entity)?.children ?? [];

      for (let i = 0; i < children.length; i++) {
        if (gameModel.hasComponent(DoNotEject, children[i]) || data.children[children[i]]) {
          continue;
        }
        const childEntity = gameModel.ejectEntity(children[i], false);

        data.entities.push(...childEntity.entities);
        data.children[childEntity.entityId] = childEntity;
      }

      const components: ComponentData[] = [];
      componentList.forEach((component) => {
        if (hasComponent(world, component, entity)) {
          const componentData = gameModel.ejectComponent(component, entity);
          if (componentData) {
            components.push(componentData);
          }
        }
      });
      data.components = components;
      data.entities.push(entity);
      data.entities = data.entities.filter((e: number) => gameModel.isActive(e)).sort();
      if (removeEjectedEntity) {
        gameModel.removeEntity(entity);
      }
      data.hasChildren = !!Object.keys(data.children).length;
      return data;
    },
    ejectComponent: <T extends Schema>(type: Constructor<T> | string, entity: number): ComponentData | null => {
      if (typeof type === "string") {
        type = getComponentByType(type) as unknown as Constructor<T>;
        if (!type) {
          return null;
        }
      }
      if (hasComponent(world, type, entity)) {
        const component = world(type, entity);
        // @ts-ignore
        const { type: componentType, ...data } = component;
        // @ts-ignore
        if (component.ejecting !== undefined) {
          // @ts-ignore
          component.ejecting = true;
        }
        gameModel.removeComponent(type, entity);
        return {
          type: componentType,
          data,
        };
      }
      return null;
    },
    removeComponent: <T extends Schema>(type: Constructor<T> | string, entity: number) => {
      if (typeof type === "string") {
        const schema = getComponentByType(type);
        if (!schema) {
          return;
        }
        removeComponent(world, schema, entity);
      } else {
        removeComponent(world, type as unknown as typeof Schema, entity);
      }
    },
    getSystemsByType: <T extends Schema>(type: Constructor<T> | string, entity?: number) => {
      if (typeof type !== "string") {
        type = type.name;
      }
      if (entity === undefined) {
        return sortedSystemsByComponent[type] || [];
      }
      return sortedSystemsByComponent[type].filter((system) => system.query.has(gameModel, entity));
    },
    runGlobalMods: (
      category: ComponentCategory,
      overrides?: {
        [key: string]: any;
      }
    ) => {
      const modComponents = gameModel.getComponentsByCategory(category);
      overrides = overrides || {};
      const sortedSystems: [SystemImpl, typeof Schema][] = [];
      const overrideKeys = Object.keys(overrides);

      if (modComponents.length) {
        modComponents.forEach((onEndComponent) => {
          const systems = gameModel.getSystemsByType(onEndComponent.type);
          if (systems.length) {
            systems.forEach((system: SystemImpl | SystemImpl[]) => {
              if (!Array.isArray(system)) {
                system = [system];
              }
              system.forEach((s) => {
                if (!sortedSystems.find((ss) => ss[0] === s)) {
                  sortedSystems.push([s, onEndComponent]);
                }
              });
            });
          }
        });
        sortedSystems.sort((a, b) => {
          return (a[0].constructor as typeof SystemImpl).depth - (b[0].constructor as typeof SystemImpl).depth;
        });

        sortedSystems.forEach(([system, component]) => {
          const actives = gameModel.getComponentActives(component.type);
          actives.forEach((entity) => {
            if (overrideKeys.length > 0) {
              const componentData = gameModel.getComponent(component, entity) as any;

              if (componentData) {
                for (const key of overrideKeys) {
                  if (componentData[key] !== undefined) {
                    componentData[key] = overrides[key];
                  }
                }
              }
            }

            system.run?.(gameModel, entity);
          });
        });
      }
    },
    runMods: (
      entity: number | number[],
      category: ComponentCategory,
      overrides?: {
        [key: string]: any;
      },
      after?: (
        system: SystemImpl<GameModel>,
        components: Schema[],
        overrides: { [key: string]: any },
        isLast: boolean
      ) => void | boolean
    ) => {
      const systemsSet = sortedSystemsByCategory[category];
      if (!systemsSet) {
        return;
      }
      if (entity === undefined) {
        return;
      }
      overrides = overrides || {};
      let entities = Array.isArray(entity) ? entity : [entity];
      if (!entities.length) {
        return;
      } else {
        entities = entities.filter((eid) => entities.indexOf(eid) <= entities.lastIndexOf(eid));
      }
      const overrideKeys = Object.keys(overrides);
      for (let i = 0; i < systemsSet.length; i++) {
        const systems = systemsSet[i] as unknown as SystemImpl<GameModel>[];
        for (let j = 0; j < systems.length; j++) {
          const system = systems[i];
          if ((system.constructor as typeof SystemImpl).depth >= 0) {
            break;
          }
          for (let k = 0; k < entities.length; k++) {
            const components: Schema[] = [];
            const entity = entities[k];
            if (overrideKeys.length > 0) {
              const systemComponents = componentsBySystem[system.constructor.name];
              for (let m = 0; m < systemComponents.length; m++) {
                const type = systemComponents[m];
                const schema = getComponentByType(type);
                if (schema && !gameModel.hasComponent(schema, entity)) {
                  k++;
                  break;
                }

                if (schema?.category === category) {
                  const component = gameModel.getComponent(schema, entity) as any;
                  components.push(component);

                  if (component) {
                    for (const key of overrideKeys) {
                      if (component[key] !== undefined) {
                        component[key] = overrides[key];
                      }
                    }
                  }
                }
              }
            }
            system.run?.(gameModel, entities[k]);
            if (after) {
              let shouldContinue = after(
                system,
                components,
                overrides,
                i === systemsSet.length - 1 && k === entities.length - 1
              );
              if (shouldContinue === false) {
                entities = entities.slice(k + 1);
                k = 0;
              }
            }
          }
        }
      }
    },
    hasComponent: <T extends Schema>(
      type: Constructor<T> | string,
      entity: number
    ): entity is EntityWithComponent<T> => {
      if (typeof type === "string") {
        const schema = getComponentByType(type);
        if (!schema) {
          return false;
        }
        return hasComponent(world, schema, entity);
      }

      return hasComponent(world, type, entity);
    },
    getComponentActives: (type: string | typeof Schema) => {
      const component = type instanceof Function ? type : getComponentByType(type);
      if (!component) {
        return [];
      }
      return defineQuery([component])(world);
    },
    isActive: (entity: number) => {
      return entityExists(world, entity);
    },
    getComponentsByCategory: (category: number, entity?: number) => {
      if (entity !== undefined) {
        return componentList.filter(
          (component) => component.category === category && hasComponent(world, component, entity)
        );
      }
      return componentsByCategory[category] || [];
    },
    getSystem: <T extends typeof SystemImpl<any>>(system: T) => {
      return getSystem(world, system);
    },
    addEntity: () => {
      return addEntity(world);
    },
    removeEntity: (entity: number) => removeEntity(world, entity),
    serializeState(): GameModelState {
      const physicsSystem = this.getSystem(PhysicsSystem);

      return {
        core: gameModel.coreEntity,
        timeElapsed: gameModel.timeElapsed,
        frame: gameModel.frame,
        world: flags.SERIALIZE_TO_BUFFER
          ? serializeWorld(SerialMode.BASE64, world)
          : serializeWorld(SerialMode.JSON, world),
        jsonWorld: flags.SERIALIZE_TO_BUFFER ? serializeWorld(SerialMode.JSON, world) : undefined,
        physics: physicsSystem.save(),
      };
    },
    deserializeState: async (state: GameModelState) => {
      gameModel.coreEntity = state.core;
      gameModel.timeElapsed = state.timeElapsed;
      gameModel.frame = state.frame;

      deleteWorld(world);

      deserializeWorld(state.world, world);

      const physicsSystem = getSystem(gameModel, PhysicsSystem);
      physicsSystem.init(gameModel, state.core);
      physicsSystem.getEngine?.(gameModel);
      await physicsSystem.restore(state.physics);
    },
    destroy: () => {
      deleteWorld(world);
      gameModel.destroyed = true;
    },
    logEntity: (entity: number, debugOverride?: boolean) => {
      if (!debugOverride && !flags.DEBUG) {
        return;
      }
      const entityData: any = {
        id: entity,
        name: gameModel.getTyped(Description, entity)?.description ?? "",
        components: {},
      };
      componentList.forEach((component) => {
        if (hasComponent(world, component, entity)) {
          entityData.components[component.name] = { ...world(component, entity) };
        }
      });
      console.trace(entityData);
    },
  });

  if (world.frame === 0) {
    gameModel.coreEntity = EntityFactory.getInstance().generateEntity(gameModel, "core");
    if (!gameModel.hasComponent(UiCleanupOnLeave, gameModel.coreEntity)) {
      gameModel.addComponent(UiCleanupOnLeave, gameModel.coreEntity);
    }
    addComponent(gameModel, Random, gameModel.coreEntity, { seed: seed ?? "" });
  }

  Object.defineProperty(gameModel, "players", {
    get: () => gameModel.getComponentActives("PlayerType"),
  });

  return gameModel;
};

export interface ReadOnlyGameModel extends GameModel {
  <T extends Schema>(schema: Constructor<T>, eid: number): Readonly<T>;
  <T extends Schema>(schema: Constructor<T>): Readonly<WorldComponent<T>>;
  getComponent: <T extends Schema>(type: Constructor<T> | string, entity: number) => Readonly<T> | null;
}
