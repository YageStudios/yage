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
  SerialMode,
} from "minecs";
import { Random } from "yage/schemas/core/Random";
import type { Random as RandomType } from "yage/utils/rand";
import "yage/systems";
import type { PhysicsSaveState } from "yage/systems/physics/Physics";
import { PhysicsSystem } from "yage/systems/physics/Physics";
import Description from "yage/schemas/core/Description";
import { flags } from "yage/console/flags";
import { EntityFactory } from "yage/entity/EntityFactory";
import type { ComponentCategory } from "yage/constants/enums";

export type GameModelState = {
  core: number;
  timeElapsed: number;
  frame: number;
  world: SerializedWorld;
  physics: PhysicsSaveState;
};

export type GameModel = World & {
  roomId: string;
  ping: number;
  timeElapsed: number;
  rand: RandomType;
  coreEntity: number;
  players: number[];
  paused: boolean;
  destroyed: boolean;
  localNetIds: string[];
  currentWorld: number;
  step: (dt?: number) => void;
  getTypedUnsafe: <T extends Schema>(type: Constructor<T>, entity: number) => T;
  getTyped: <T extends Schema>(type: Constructor<T>, entity: number) => T | null;
  hasComponent: <T extends Schema>(type: Constructor<T> | string, entity: number) => boolean;
  getComponent: <T extends Schema>(type: Constructor<T> | string, entity: number) => T | any | null;
  addComponent: <T extends Schema>(
    type: Constructor<T> | string,
    entity: number,
    overrides?: Partial<T>,
    reset?: boolean
  ) => void;
  getComponentActives: (type: string | typeof Schema) => number[];
  getComponentSchemasByCategory: (category: number, entity?: number) => (typeof Schema)[];
  removeComponent: <T extends Schema>(type: Constructor<T> | string, entity: number) => void;
  isActive: (entity: number) => boolean;
  getSystemsByType: (type: string, entity?: number) => SystemImpl<any>[];
  getSystem: <T extends typeof SystemImpl<any>>(system: T) => InstanceType<T>;
  addEntity: () => number;
  removeEntity: (entity: number) => void;
  serializeState: () => any;
  destroy: () => void;
  logEntity: (entity: number, debugOverride?: boolean) => void;
  runMods: (
    entity: number | number[],
    category: ComponentCategory,
    overrides?: {
      [key: string]: any;
    }
  ) => void;
};

export const GameModel = ({
  world = createWorld(),
  seed,
  roomId,
}: {
  world?: World;
  seed?: string;
  roomId?: string;
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
    systems.forEach((system) => {
      acc[system.constructor.name] = acc[system.constructor.name] || [];
      acc[system.constructor.name].push(type);
    });
    return acc;
  }, {} as Record<string, string[]>);

  const gameModel = Object.assign(world, {
    roomId: roomId ?? "",
    coreEntity: addEntity(world),
    timeElapsed: 0,
    rand: null as any,
    ping: 0,
    paused: false,
    destroyed: false,
    players: [],
    localNetIds: [],
    currentWorld: -1,
    step: (dt?: number) => {
      gameModel.timeElapsed += dt || 16;
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
    getTyped: <T extends Schema>(type: Constructor<T>, entity: number) => {
      if (hasComponent(world, type, entity)) {
        return world(type, entity);
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
    runMods: (
      entity: number | number[],
      category: ComponentCategory,
      overrides?: {
        [key: string]: any;
      }
    ) => {
      const systems = sortedSystemsByCategory[category];
      const entities = Array.isArray(entity) ? entity : [entity];
      const overrideKeys = Object.keys(overrides || {});
      for (let i = 0; i < systems.length; i++) {
        const system = systems[i];
        if ((system.constructor as typeof SystemImpl).depth >= 0) {
          break;
        }
        for (let j = 0; j < entities.length; j++) {
          const entity = entities[j];
          if (overrideKeys.length > 0) {
            const systemComponents = componentsBySystem[system.constructor.name];
            for (let k = 0; k < systemComponents.length; k++) {
              const type = systemComponents[k];
              const schema = getComponentByType(type);
              if (schema?.category === category) {
                const component = gameModel.getComponent(schema, entity) as any;
                if (component) {
                  for (const key of overrideKeys) {
                    if (component[key] !== undefined) {
                      // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
                      component[key] = overrides![key];
                    }
                  }
                }
              }
            }
          }
          system.run?.(gameModel, entities[j]);
        }
      }
    },
    hasComponent: <T extends Schema>(type: Constructor<T> | string, entity: number) => {
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
    getComponentSchemasByCategory: (category: number, entity?: number) => {
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
    addEntity: () => addEntity(world),
    removeEntity: (entity: number) => removeEntity(world, entity),
    serializeState(): GameModelState {
      const physicsSystem = this.getSystem(PhysicsSystem);
      // const serializedWorld = bitecs.serializeWorld(this.bitecsWorld, state.activeByComponent);

      return {
        core: gameModel.coreEntity,
        timeElapsed: gameModel.timeElapsed,
        frame: gameModel.frame,
        world: serializeWorld(SerialMode.JSON, world),
        physics: physicsSystem.save(),
      };
    },
    destroy: () => {
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
      console.log(entityData);
    },
  });

  if (world.frame === 0) {
    gameModel.coreEntity = EntityFactory.getInstance().generateEntity(gameModel, "core");
    addComponent(gameModel, Random, gameModel.coreEntity, { seed: seed ?? "" });
  }

  Object.defineProperty(gameModel, "players", {
    get: () => gameModel.getComponentActives("PlayerType"),
  });

  return gameModel;
};

export interface ReadOnlyGameModel extends GameModel {
  <T extends Schema>(schema: Constructor<T>, eid: number): Readonly<T>;
  <T extends Schema>(schema: Constructor<T>): Readonly<WorldComponent>;
  getComponent: <T extends Schema>(type: Constructor<T> | string, entity: number) => Readonly<T> | null;
}
