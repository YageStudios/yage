import * as bitecs from "bitecs";
import { clone, cloneDeep } from "lodash";
import type * as PIXI from "pixi.js";

import { EntityTypeSchema, PhysicsSystem, TimeDilationSchema } from "@/components/";
import {
  canRegisterComponents,
  componentIndexMap,
  componentList,
  componentsByCategory,
  uiComponents,
  generateRunList,
  generateSystems,
  getIndex,
  pixiDrawComponents,
  uiComponentsById,
} from "@/components/ComponentRegistry";
import type { PixiDrawSystem } from "@/components/PixiDrawSystem";
import type { System } from "@/components/System";
import type { ComponentCategory, ComponentData } from "@/components/types";

import { hacks } from "@/console/hacks";
import { EntityType } from "@/constants/enums";

import type { BitecsSchema, Schema } from "@/decorators/type";
import { TypeSchema } from "@/decorators/type";

import { EntityFactory } from "@/entity/EntityFactory";

import { Persist } from "@/persist/persist";

import { ByteArray } from "@/utils/byteArray";
import type { SpatialMap } from "@/utils/Collision";
import type { Random } from "@/utils/rand";
import type { Vector2d } from "@/utils/vector";
import { isVector2d, scaleVector2d } from "@/utils/vector";

import DescriptionSchema from "@/schemas/core/Description";
import { RandomSchema } from "@/schemas/core/Random";
import { SpatialMapSchema } from "@/schemas/core/SpatialMap";
import { ParentSchema } from "@/schemas/entity/Parent";
import { UIService } from "@/ui/UIService";
import { md5 } from "@/utils/md5";
import { GameInstance } from "./GameInstance";
import { GameCoordinator } from "./GameCoordinator";

// import { MapSpawnSchema } from "../../src/stunningumbrella/components";

type Constructor<T> = {
  new (...args: any[]): T;
};

export type GameModelState = {
  core: number;
  timeElapsed: number;
  frame: number;
  frameDt: number;
  entities: any;
};

export type GameState = {
  type: "internal";
  entityComponentArray: ByteArray[];
  components: TypeSchema[][];
  activeEntities: number[];
  limboEntities: number[];
  availableEntities: number[];
  activeByComponent: number[][];
};

const dt = <T>(deltaTime: number, arg?: undefined | T, scale = 1): T => {
  if (arg === undefined) {
    return (deltaTime * scale) as unknown as T;
  }
  const _secondTime = scale !== 1 ? (deltaTime / 1000) * scale : deltaTime / 1000;
  if (typeof arg === "number") {
    return (arg * _secondTime) as unknown as T;
  }
  if (isVector2d(arg)) {
    return scaleVector2d(arg as Vector2d, _secondTime) as unknown as T;
  }
  return arg;
};

const increment = (deltaTime: number, current: number, max: number, delta: number) => {
  const next = current + dt(deltaTime, delta);
  if (next >= max) {
    return 0;
  }
  return next;
};

export class GameModel {
  state: GameState;

  drawComponents: { [key: string]: PixiDrawSystem } = {};

  app: PIXI.Application;

  runList: string[] = [];
  predrawRunList: string[] = [];

  timings: any[] = [];
  timingFrame = 0;

  entityCounter = 0;

  world: any;
  netId: string = "";

  systems: { [key: string]: System };

  public coreEntity: number;
  running: boolean;
  destroyed: boolean;

  public constructor(public gameCoordinator: GameCoordinator, public instance?: GameInstance<any>, state?: GameState) {
    this.state = state || {
      type: "internal",
      entityComponentArray: [],
      components: [],
      activeEntities: [],
      limboEntities: [],
      availableEntities: [],
      activeByComponent: [],
    };

    this.world = bitecs.createWorld();

    pixiDrawComponents.sort((a, b) => a.zIndex - b.zIndex);

    pixiDrawComponents.forEach((drawComponent) => {
      this.drawComponents[drawComponent.type] = new drawComponent.system();
    });
    if (state) {
      return;
    }
    this.generateEntityData(20000);
    this.app = gameCoordinator.pixiApp;
    this.coreEntity = EntityFactory.getInstance().generateEntity(this, "core");
    const physicsSystem = this.getSystem(PhysicsSystem);
    physicsSystem?.getEngine?.(this);
  }

  public get spatialMap(): SpatialMap<number> {
    return this.getTyped(this.coreEntity, SpatialMapSchema).spatialMap;
  }

  public get rand(): Random {
    return this.getTyped(this.coreEntity, RandomSchema).random;
  }

  public get players(): number[] {
    return this.getComponentActives("PlayerType") ?? [];
  }

  public get enemies(): number[] {
    return this.getComponentActives("EnemyType");
  }

  public get pickups(): number[] {
    return this.getComponentActives("PickupType");
  }

  public get projectiles(): number[] {
    return this.getComponentActives("ProjectileType");
  }

  public get walls(): number[] {
    return this.getComponentActives("WallType");
  }

  public get doors(): number[] {
    return this.getComponentActives("DoorType");
  }

  public get interactables(): number[] {
    return this.getComponentActives("InteractableType");
  }

  public increment(entity: number, current: number, max: number, delta: number) {
    if (this.hasComponent(entity, "TimeDilation")) {
      return increment(this.frameDt, current, max, delta * this.getTyped(entity, TimeDilationSchema).amount);
    }
    return increment(this.frameDt, current, max, delta);
  }

  public dt = <T>(entity: number, arg?: undefined | T): T => {
    if (this.hasComponent(entity, "TimeDilation")) {
      return dt(this.frameDt, arg, this.getTyped(entity, TimeDilationSchema).amount);
    }
    return dt(this.frameDt, arg);
  };

  public getEntities(entityType?: EntityType | EntityType[]): number[] {
    if (entityType !== undefined) {
      if (!Array.isArray(entityType)) {
        entityType = [entityType];
      }
      return entityType
        .map((type) => {
          switch (type) {
            case EntityType.ALLY:
              return this.players;
            case EntityType.ENEMY:
              return this.enemies;
            case EntityType.PROJECTILE:
              return this.projectiles;
            case EntityType.PICKUP:
              return this.pickups;
            case EntityType.WALL:
              return this.walls;
            case EntityType.INTERACTABLE:
              return this.interactables;
          }
          return [];
        })
        .flat();
    }

    return this.entities;
  }

  public get entities(): number[] {
    return [...this.players, ...this.enemies, ...this.pickups, ...this.projectiles, ...this.walls];
  }

  public getEntityByDescription(description: string): number[] | undefined {
    const entities = this.getComponentActives("Description");
    return entities?.filter((entity) => {
      const desc = this.getTyped(entity, DescriptionSchema);
      return desc.description === description;
    });
  }

  public frame = 0;
  public frameDt = 0;
  public timeElapsed = 0;
  public paused = false;

  getNextEntityId = () => {
    return this.entityCounter;
  };

  generateEntityData = (entityCount: number) => {
    canRegisterComponents(false);
    this.systems = generateSystems(this);
    const [runList, predrawRunList] = generateRunList(Object.values(this.systems));

    this.runList = runList;
    this.predrawRunList = predrawRunList;

    this.state.entityComponentArray = [];
    this.state.components = [];
    this.state.activeEntities = [];
    this.state.activeByComponent = [];
    this.state.availableEntities = [];

    for (let i = 0; i < entityCount; i++) {
      this.state.entityComponentArray.push(new ByteArray());
      const componentArray: TypeSchema[] = [];
      for (let j = 0; j < componentList.length; j++) {
        componentArray.push(new TypeSchema({ type: componentList[j].type }));
      }
      this.state.components.push(componentArray);
    }
    for (let i = 0; i < componentList.length; ++i) {
      this.state.activeByComponent.push([]);
    }
  };

  private copyComponentData = (entity: number, i: number, remapEntities = true) => {
    let componentData: any = {};
    const component = componentList[i];
    if (this.isBitecs(i)) {
      const bitecsComponent: any = {};
      const schema = componentList[i].schema;
      Object.keys(schema.store).forEach((bitecsKey) => {
        if (bitecsKey !== "__changes") {
          bitecsComponent[bitecsKey] = schema.store[bitecsKey][entity];
        }
      });
      componentData = {
        type: schema.__type,
        data: bitecsComponent,
      };
    } else {
      const cloned = clone(this.state.components[entity][i]);
      delete (cloned as any).type;
      componentData = {
        type: component.type,
        data: cloned,
      };
    }
    if (remapEntities && component.schema.__entityTypes) {
      const entityKeys = Object.keys(component.schema.__entityTypes);
      entityKeys.forEach((entityKey) => {
        const entityValue = componentData.data[entityKey];
        if (entityValue) {
          // acc[entity][componentId][entityKey] = entityValue.id;
          componentData.data[entityKey] = {
            entities: clone(entityValue),
          };
        }
      });
    }

    return componentData;
  };

  cloneEntity = (entity: number): any => {
    const clonedEntity = this.addEntity();
    const entityData = this.state.entityComponentArray[entity];

    const children = (this.getTyped(entity, ParentSchema) as ParentSchema).children ?? [];

    const childrenData: number[] = [];
    for (let i = 0; i < children.length; i++) {
      childrenData.push(this.cloneEntity(children[i]));
    }

    for (let i = 0; i < componentList.length; i++) {
      if (entityData.get(i)) {
        // const component = componentList[i];
        const cloned = clone(this.state.components[entity][i]);
        this.setComponent(clonedEntity, (cloned as any).type, cloned as any);
        this.cleanupComponent(clonedEntity, (cloned as any).type, true);
      }
    }
    if (childrenData.length) {
      const parentData = this.getTyped(clonedEntity, ParentSchema);
      parentData.children = new Array<number>(...childrenData);
    }
    return clonedEntity;
  };

  injectEntity = (
    entityData: {
      entityType: string;
      description: string;
      entityId: number;
      components: any[];
      entities: any[];
      children: any;
    },
    entityMap?: { [key: string]: number }
  ) => {
    if (!entityMap) {
      entityMap = {};
      for (let i = 0; i < entityData.entities.length; i++) {
        entityMap[entityData.entities[i]] = this.addEntity();
      }
    }
    const entityId = entityMap[entityData.entityId];

    for (let i = 0; i < entityData.components.length; i++) {
      this.mapComponentEntites(entityData.components[i], entityMap);
      this.setComponent(entityId, entityData.components[i].type, entityData.components[i].data);
    }

    Object.values(entityData.children).forEach((childEntityData: any) => {
      this.injectEntity(childEntityData, entityMap);
    });

    return entityId;
  };

  ejectEntity = (entity: number): any => {
    const data = {
      entityType: EntityTypeSchema.store.entityType[entity],
      description: this.getTyped(entity, DescriptionSchema).description,
      entityId: entity,
      components: [],
      entities: [],
      children: {},
    } as any;
    const entityData = this.state.entityComponentArray[entity];

    const children = (this.getTyped(entity, ParentSchema) as ParentSchema).children ?? [];

    for (let i = 0; i < children.length; i++) {
      const childEntity = this.ejectEntity(children[i]);
      data.entities.push(...childEntity.entities);
      data.children[childEntity.entityId] = childEntity;
    }

    const components = [];

    for (let i = 0; i < componentList.length; i++) {
      if (entityData.get(i)) {
        const componentData = this.ejectComponent(entity, i);
        components.push(componentData);
      }
    }
    data.components = components;
    data.entities.push(entity);
    this.removeEntity(entity);
    data.hasChildren = !!children.length;
    return data;
  };

  ejectComponent = (entity: number, i: number | string) => {
    if (typeof i === "string") {
      i = componentList.findIndex((c) => c.type === i);
    }

    this.cleanupComponent(entity, i, true);

    const cloned: ComponentData = this.copyComponentData(entity, i);

    const activeIndex = this.state.activeByComponent[i].indexOf(entity);

    if (activeIndex > -1) {
      this.state.activeByComponent[i].splice(activeIndex, 1);
    }

    return cloned;
  };

  logEntity = (entity: number, overrideDebug = false) => {
    const data = {
      entityType: EntityTypeSchema.store.entityType[entity],
      description: this.hasComponent(entity, DescriptionSchema)
        ? this.getTyped(entity, DescriptionSchema).description
        : "",
      components: [],
      id: entity,
    } as any;

    const entityData = this.state.entityComponentArray[entity];
    for (let i = 0; i < componentList.length; i++) {
      if (entityData.get(i)) {
        const component = this.copyComponentData(entity, i, false);
        data.components.push(component);
      }
    }
    if (hacks.DEBUG || overrideDebug) {
      if (typeof window === "undefined") {
        console.log(JSON.stringify(data, null, 2));
      } else {
        console.log(data);
      }
      const stack = new Error().stack?.split("\n").slice(2).join("\n").substring(4);
      console.log("Entity log " + stack);
    }
  };

  addEntity = (): number => {
    let entity = bitecs.addEntity(this.world);
    // weird edge case where entity is undefined
    while (entity === undefined) {
      console.error("entity is undefined, trying again");
      entity = bitecs.addEntity(this.world);
    }
    this.state.activeEntities.push(entity);
    return entity;
  };

  removeEntity = (entity: number) => {
    const viewport = this.gameCoordinator.pixiViewport;
    const index = this.state.activeEntities.indexOf(entity);
    if (index > -1) {
      this.state.activeEntities.splice(index, 1);
      this.state.limboEntities.push(entity);
      const mask = this.state.entityComponentArray[entity];
      for (let i = 0; i < componentList.length; i++) {
        if (mask.get(i)) {
          const typeString = componentList[i].type;
          const system = this.systems[typeString];
          if (system?.cleanup) {
            system.cleanup(entity, this, false);
          }
          const uiComponent = uiComponents[uiComponentsById[i]];
          if (uiComponent && uiComponent.cleanup) {
            uiComponent.cleanup(UIService.getInstance(), entity, this, false);
          }

          if (this.drawComponents[typeString]) {
            this.drawComponents[typeString].cleanup?.(entity, this, viewport);
          }
          const activeIndex = this.state.activeByComponent[i].indexOf(entity);
          if (activeIndex > -1) {
            this.state.activeByComponent[i].splice(activeIndex, 1);
          }
          if (this.isBitecs(i)) {
            const schema = componentList[i].schema;
            Object.keys(schema.store).forEach((bitecsKey) => {
              schema.store[bitecsKey][entity] = 0;
            });
          }
          this.state.components[entity][i] = new TypeSchema({ type: typeString });
          mask.set(i, false);
        }
      }
      this.state.entityComponentArray[entity] = new ByteArray();
    }
    bitecs.removeEntity(this.world, entity);
  };

  run = () => {
    this.running = true;
    for (let i = 0; i < this.runList.length; i++) {
      this.runComponent(this.runList[i]);
    }
    this.running = false;
  };

  runPredraw = () => {
    for (let i = 0; i < this.predrawRunList.length; i++) {
      this.runComponent(this.predrawRunList[i]);
    }
  };

  cleanup = () => {
    for (let i = 0; i < this.state.limboEntities.length; i++) {
      this.state.availableEntities.push(this.state.limboEntities[i]);
    }
    this.state.limboEntities = [];

    if (hacks.PERFORMANCE_LOGS) {
      // @ts-ignore
      window.performanceUpdate(this.timings);
      this.timings = [];
    }
  };

  cleanupEntity = (entity: number) => {
    for (let i = 0; i < componentList.length; i++) {
      if (this.state.entityComponentArray[entity].get(i)) {
        this.cleanupComponent(entity, i, false);
      }
    }
  };

  cleanupComponent = (entity: number, type: string | number, ejecting = false) => {
    const index = getIndex(type);

    const typeString = componentList[index].type;
    const system = this.systems[typeString];
    if (system?.cleanup) {
      system.cleanup(entity, this, ejecting);
    }

    const uiComponent = uiComponents[uiComponentsById[index]];
    if (uiComponent && uiComponent.cleanup) {
      uiComponent.cleanup(UIService.getInstance(), entity, this, ejecting);
    }

    const drawComponent = this.drawComponents[componentList[index].type];
    if (drawComponent && drawComponent.cleanup) {
      drawComponent.cleanup(entity, this, this.gameCoordinator.pixiViewport);
    }
  };

  isActive = (entity: number) => {
    return bitecs.entityExists(this.world, entity); //this.state.activeEntities.indexOf(entity) !== -1;
  };

  hasComponent = (entity: number, type: string | number | typeof Schema): boolean => {
    const index = getIndex(type);

    return entity > -1 && this.state.entityComponentArray[entity].has(index);
  };

  validateComponent(entity: number, ComponentSchema: any, overrides?: { [key: string]: any }) {
    overrides = overrides || {};
    Object.entries(overrides).forEach(([key, value]) => {
      if (typeof value === "object" && value?.toJSON) {
        // @ts-ignore
        overrides[key] = value.toJSON();
      }
    });

    // @ts-ignore
    if (!ComponentSchema.__validate(overrides)) {
      console.error("Validation Error");
      console.error(
        overrides,
        // @ts-ignore
        ComponentSchema.__schema
      );
      console.error(ComponentSchema.__validate.errors);
      throw new Error(`Invalid schema for component ${ComponentSchema.__type} on entity ${entity}`);
    }
    return overrides;
  }

  getComponentSchema = (type: string | number | typeof Schema) => {
    const index = getIndex(type);
    return componentList[index].schema;
  };

  setTyped = <T>(entity: number, type: Constructor<T>, overrides?: Partial<T>) => {
    // @ts-ignore
    return this.setComponent(entity, type.__type, overrides);
  };

  setComponent = (
    entity: number,
    type: string | number | typeof Schema,
    overrides?: { [key: string]: any },
    skipInit = false
  ) => {
    const index = getIndex(type);

    try {
      if (entity < 0) {
        throw new Error("Cannot set component on invalid entity");
      }
      this.state.entityComponentArray[entity].enable(index);

      if (!this.state.activeByComponent[index].includes(entity)) {
        this.state.activeByComponent[index].push(entity);
      }
      const ComponentSchema = componentList[index].schema;

      if (typeof ComponentSchema === "undefined") {
        overrides = {};
      } else {
        overrides = this.validateComponent(entity, ComponentSchema, overrides);
      }

      if (ComponentSchema?.store) {
        bitecs.addComponent(this.world, ComponentSchema.store, entity);
        ComponentSchema.id = entity;
        Object.entries(overrides).forEach(([key, value]) => {
          // @ts-ignore
          ComponentSchema[key] = value;
        });

        const typeString = componentList[index].type;
        const system = this.systems[typeString];
        if (system?.init && !skipInit) {
          system.init(entity, this);
        }

        return;
      }

      if (!ComponentSchema) {
        this.state.components[entity][index] = new TypeSchema({
          type: componentList[index].type,
        });
      } else {
        this.state.components[entity][index] = {
          ...overrides,
          type: componentList[index].type,
        };
      }
      const typeString = componentList[index].type;
      const system = this.systems[typeString];
      if (system?.init && !skipInit) {
        system.init(entity, this);
      }
    } catch (e) {
      console.error(e);
      console.error(entity, type, overrides);
      throw e;
    }
  };

  removeComponent = (entity: number, type: typeof Schema | string | number) => {
    const index = getIndex(type);

    this.state.entityComponentArray[entity].disable(index);

    this.cleanupComponent(entity, index);

    const activeIndex = this.state.activeByComponent[index].indexOf(entity);

    if (activeIndex > -1) {
      this.state.activeByComponent[index].splice(activeIndex, 1);
    }
    this.state.components[entity][index] = new TypeSchema({ type: componentList[index].type });
  };

  getCategory = (type: typeof Schema | string | number) => {
    const index = getIndex(type);

    return componentList[index].category;
  };

  getBitecs = <T extends BitecsSchema>(entity: number, type: Constructor<T>) => {
    // @ts-ignore
    type.id = entity;
    return type;
  };

  isBitecs = (type: typeof Schema | string | number) => {
    const index = getIndex(type);

    return !!componentList[index].schema?.store;
  };

  getSystem = <T extends System>(type: Constructor<T> | typeof Schema | string | number) => {
    let typeString = (type as any)?.__type;
    if (!typeString) {
      const index = getIndex(type as any);
      typeString = componentList[index].type;
    }

    // @ts-ignore
    return this.systems[typeString] as T;
  };

  getPixiSystem = <T extends PixiDrawSystem>(type: Constructor<T> | typeof Schema | string | number) => {
    let typeString = (type as any)?.__type;
    if (!typeString) {
      const index = getIndex(type as any);
      typeString = componentList[index].type;
    }

    // @ts-ignore
    return this.drawComponents[typeString] as T;
  };

  getTyped = <T>(entity: number, type: Constructor<T>) => {
    // @ts-ignore
    return this.getComponent(entity, type.__type) as T;
  };

  getComponent = (entity: number, type: typeof Schema | string | number) => {
    const index = getIndex(type);
    if (componentList[index].schema?.store) {
      componentList[index].schema.id = entity;
      return componentList[index].schema;
    }

    return this.state.components[entity][index];
  };

  getComponentIndex = (type: string) => {
    return componentIndexMap[type];
  };

  getComponentActives = (type: string | number) => {
    return this.state.activeByComponent[getIndex(type)];
  };

  getComponentIdsByCategory = (entity: number, category: ComponentCategory) => {
    const result: number[] = [];
    if (!componentsByCategory[category]) {
      return result;
    }
    for (let i = 0; i < componentsByCategory[category].length; i++) {
      if (this.state.entityComponentArray[entity].has(componentsByCategory[category][i])) {
        result.push(componentsByCategory[category][i]);
      }
    }
    return result;
  };

  runComponent = (type: string) => {
    try {
      let time = 0;
      if (hacks.PERFORMANCE_LOGS) {
        time = performance.now();
      }
      const index = getIndex(type);
      const component = componentList[index];
      const componentSystem = this.systems[type];

      const actives = this.state.activeByComponent[componentIndexMap[type]];

      if (componentSystem.runAll) {
        if (actives.length) {
          componentSystem.runAll(this);
        }
        if (hacks.PERFORMANCE_LOGS) {
          this.timings.push({ type, time: performance.now() - time });
        }
        return;
      }

      for (let i = 0; i < actives.length; ++i) {
        const length = actives.length;
        componentSystem.run?.(actives[i], this);

        if (length !== actives.length) {
          i--;
        } else if (hacks.DEBUG && typeof component.schema === "function") {
          const data = this.state.components[actives[i]][index];

          if (!component.schema.__validate(data)) {
            console.error("Validation Error");
            console.error(component.schema.__validate.errors);

            console.error(
              data,
              // @ts-ignore
              component.schema.__schema
            );
            this.logEntity(actives[i], true);
            throw new Error(`Invalid schema for component ${type} on entity ${actives[i]}`);
          }
        }
      }

      if (hacks.PERFORMANCE_LOGS) {
        this.timings.push({ type, time: performance.now() - time });
      }
    } catch (e) {
      console.error(e);
      console.error(type);
      throw e;
    }
  };

  runPixiComponents = () => {
    const viewport = this.gameCoordinator.pixiViewport;

    for (let i = 0; i < pixiDrawComponents.length; i++) {
      const pixi = pixiDrawComponents[i];
      if (pixi.id === -1) {
        pixi.id = this.getComponentIndex(pixi.type);
      }
      const actives: number[] = this.state.activeByComponent[pixi.id];
      const drawComponent = this.drawComponents[pixi.type];

      if (drawComponent.debug && !hacks.DEBUG) {
        for (let i = 0; i < actives.length; ++i) {
          if (drawComponent.ids.has(actives[i])) {
            drawComponent.cleanup(actives[i], this, viewport);
          }
        }
        continue;
      }

      for (let j = 0; j < actives.length; j++) {
        const entity = actives[j];
        if (drawComponent.ids && !drawComponent.ids.has(entity)) {
          drawComponent.init(actives[j], this, viewport);
        }
        drawComponent.run(actives[j], this, viewport);
      }
    }
  };

  getDependencies = (type: string) => {
    return this.systems[type]?.dependencies ?? [];
  };

  runUIComponents = () => {
    const uiService = UIService.getInstance();
    for (let i = 0; i < uiComponents.length; i++) {
      const uiComponent = uiComponents[i];
      if (uiComponent.id === -1) {
        uiComponent.id = this.getComponentIndex(uiComponent.type);
      }
      if (uiComponentsById[uiComponent.id] === undefined) {
        uiComponentsById[uiComponent.id] = i;
      }
      let actives = this.state.activeByComponent[uiComponent.id] as number[];
      if (uiComponent.sort) {
        actives = actives.concat().sort((a, b) => uiComponent.sort(a, b, this));
      }
      for (let j = 0; j < actives.length; j++) {
        const entity = actives[j];
        if (uiComponent.debug && !hacks.DEBUG) {
          continue;
        }
        try {
          uiComponent.system(uiService, entity, this, this.gameCoordinator.pixiViewport);
        } finally {
          // noop
        }
      }
    }
  };

  defineQuery(schema: typeof BitecsSchema | (typeof BitecsSchema)[]) {
    return bitecs.defineQuery((Array.isArray(schema) ? schema : [schema]).map((s: typeof BitecsSchema) => s.store));
  }

  isOf(entity: number, type: string) {
    if (this.hasComponent(entity, "Description")) {
      return this.getTyped(entity, DescriptionSchema).description === type;
    }
    return false;
  }

  mapComponentEntites = (component: any, entityMap: any) => {
    const componentData = component.data ?? component;
    const componentId = this.getComponentIndex(component.type);
    if (componentList[componentId].schema.__entityTypes) {
      const entityKeys = Object.keys(componentList[componentId].schema.__entityTypes);
      entityKeys.forEach((entityKey) => {
        const entityValue = componentData[entityKey];
        if (entityValue) {
          if (Array.isArray(entityValue.entities)) {
            componentData[entityKey] = entityValue.entities.map((e: number) =>
              e !== -1 && e !== null ? entityMap[e] : e
            );
          } else {
            componentData[entityKey] =
              typeof entityValue.entities === "number" && entityValue.entities > -1
                ? entityMap[entityValue.entities]
                : entityValue.entities;
          }
        }
      });
    }
  };

  serializeState(): GameModelState {
    const state = this.state;

    const activesEntities = cloneDeep(state.activeEntities);
    const saveObject = activesEntities.reduce((acc, entity) => {
      const components = state.components[entity];
      const entityComponentArray = state.entityComponentArray[entity];
      acc[entity] = {};

      entityComponentArray.bytes.forEach((componentId) => {
        if (this.isBitecs(componentId)) {
          const bitecsComponent: any = {};
          const schema = componentList[componentId].schema;
          Object.keys(schema.store).forEach((bitecsKey) => {
            if (bitecsKey !== "__changes") {
              bitecsComponent[bitecsKey] = schema.store[bitecsKey][entity];
            }
          });
          bitecsComponent.type = schema.__type;
          acc[entity][componentId] = bitecsComponent;
        } else {
          if (!components[componentId].type) {
            console.log(components[componentId], componentList[componentId].type);
            components[componentId].type = componentList[componentId].type;
          }
          acc[entity][componentId] = clone(components[componentId]);
        }
        if (componentList[componentId].schema.__entityTypes) {
          const entityKeys = Object.keys(componentList[componentId].schema.__entityTypes);
          entityKeys.forEach((entityKey) => {
            const entityValue = acc[entity][componentId][entityKey];
            if (entityValue) {
              // acc[entity][componentId][entityKey] = entityValue.id;
              acc[entity][componentId][entityKey] = {
                entities: clone(entityValue),
              };
            }
          });
        }
      });
      return acc;
    }, {} as any);

    return {
      core: this.coreEntity,
      timeElapsed: this.timeElapsed,
      frame: this.frame,
      frameDt: this.frameDt,
      entities: saveObject,
    };
  }

  async saveState(id: string) {
    const saveObject = this.serializeState();

    const save = {
      id,
      state: saveObject,
    };

    await Persist.getInstance().set(id, save);
  }

  async removeSave(id: string) {
    await Persist.getInstance().remove(id);
  }

  async loadState(id: string) {
    const save = await Persist.getInstance().get(id);
    if (save) {
      this.loadStateObject(save.state);
    }
  }

  clearState() {
    for (let i = this.state.activeEntities.length; i >= 0; i--) {
      if (this.isActive(this.state.activeEntities[i]) && this.state.activeEntities[i] !== this.coreEntity) {
        this.removeEntity(this.state.activeEntities[i]);
      }
    }
    this.removeEntity(this.coreEntity);

    bitecs.deleteWorld(this.world);

    this.world = bitecs.createWorld();

    this.generateEntityData(20000);
  }

  loadStateObject(saveObject: any) {
    if (this.state.activeEntities.length > 0) {
      this.clearState();
    }
    const state = this.state;
    const entities = Object.keys(saveObject.entities).map((e) => parseInt(e, 10));
    const entityMap = {} as any;
    entities.forEach((entity) => {
      const newEntity = this.addEntity();
      entityMap[entity] = newEntity;
    });

    this.coreEntity = entityMap[saveObject.core];

    const generateEntity = (entity: number) => {
      const components = saveObject.entities[entity];
      const componentIds = Object.keys(components).map((c) => parseInt(c, 10));
      const newEntity = entityMap[entity];

      componentIds.forEach((componentId) => {
        state.activeByComponent[componentId].push(newEntity);
        state.entityComponentArray[newEntity].set(componentId, true);

        if (componentList[componentId].schema.__entityTypes) {
          const entityKeys = Object.keys(componentList[componentId].schema.__entityTypes);
          entityKeys.forEach((entityKey) => {
            const entityValue = components[componentId][entityKey];
            if (entityValue) {
              if (Array.isArray(entityValue.entities)) {
                components[componentId][entityKey] = entityValue.entities.map((e: number) =>
                  e !== -1 && e !== null ? entityMap[e] : e
                );
              } else {
                components[componentId][entityKey] =
                  typeof entityValue.entities === "number" && entityValue.entities > -1
                    ? entityMap[entityValue.entities]
                    : entityValue.entities;
              }
            }
          });
        }
        if (!this.isBitecs(componentId)) {
          state.components[newEntity][componentId] = components[componentId];
        } else {
          const schema = componentList[componentId].schema;
          const bitecsComponent = components[componentId];

          bitecs.addComponent(this.world, schema.store, newEntity);
          schema.id = entity;

          Object.keys(schema.store).forEach((bitecsKey) => {
            if (bitecsKey !== "__changes" && bitecsComponent[bitecsKey] !== undefined) {
              schema.store[bitecsKey][newEntity] = bitecsComponent[bitecsKey];
            }
          });
        }
      });
    };
    generateEntity(saveObject.core);

    entities.forEach((entity) => entity !== saveObject.core && generateEntity(entity));
    this.state = state;
    this.frame = saveObject.frame;
    this.frameDt = saveObject.frameDt;
    this.timeElapsed = saveObject.timeElapsed;

    const physicsSystem = this.getSystem(PhysicsSystem);
    physicsSystem?.getEngine?.(this);
    var uint8array = physicsSystem.world?.takeSnapshot();
    var string = new TextDecoder().decode(uint8array);

    const md5String = md5(string);

    console.log(md5String);
  }

  destroy() {
    this.clearState();
    UIService.getInstance().clearUI();
    this.destroyed = true;
  }
}
