/**
 * A GameModel-shaped wrapper over a lean world (yage/world/lean) for scenes that bring their own
 * components and systems: no yage/systems registry, physics (Rapier), EntityFactory or core entity.
 * It has the GameModel members draw systems such as PixiViewportSystem use (getTypedUnsafe,
 * hasComponent, addComponent, roomId, frame, players, localNetIds, paused...), so they run on it.
 *
 * Import as `yage/game/LeanGameModel`. Engine systems that need a real GameModel (physics, maps,
 * entity ejection, serializeState) are not supported; use GameModel for those.
 */
import {
  addComponent,
  addEntity,
  deleteWorld,
  defineQuery,
  entityExists,
  getComponentByType,
  getSystem,
  getSystemsByType,
  hasComponent,
  isComponentRegistered,
  removeComponent,
  removeEntity,
  stepWorld,
  stepWorldDraw,
  type Constructor,
  type Schema,
  type SystemImpl,
  type World,
} from "minecs";
import type { InputManager } from "yage/inputs/InputManager";
import { FIXED_TIMESTEP_MS } from "yage/game/Timing";
import { leanWorldType, type LeanWorldSpec, type LeanWorldType } from "yage/world/lean";

type SchemaRef<T extends Schema = Schema> = Constructor<T> | string;

export type LeanGameModel = World & {
  inputManager?: InputManager;
  roomId: string;
  seed: string;
  /** Entities with PlayerType, when that component is registered; otherwise []. */
  readonly players: number[];
  localNetIds: string[];
  paused: boolean;
  destroyed: boolean;
  timeElapsed: number;
  frameDt: number;
  /** Always -1: a lean model has no core entity. */
  coreEntity: number;
  /** Runs the simulation systems once (skipped while paused). `dt` defaults to the fixed timestep. */
  step(dt?: number): void;
  /** Runs the draw systems once. */
  stepDraw(): void;
  /** step(dt) then stepDraw(): one frame of a scene loop. */
  run(dt?: number): void;
  addEntity(): number;
  removeEntity(entity: number): void;
  isActive(entity: number): boolean;
  addComponent<T extends Schema>(type: SchemaRef<T>, entity: number, overrides?: Partial<T>, reset?: boolean): void;
  removeComponent<T extends Schema>(type: SchemaRef<T>, entity: number): void;
  hasComponent<T extends Schema>(type: SchemaRef<T>, entity: number): boolean;
  getTypedUnsafe<T extends Schema>(type: Constructor<T>, entity: number): T;
  getTyped<T extends Schema>(type: Constructor<T>, entity: number): T | null;
  getComponent<T extends Schema>(type: SchemaRef<T>, entity: number): T | null;
  /** Entities that have `type` ([] when it is not registered in this world). */
  getComponentActives(type: SchemaRef): number[];
  getSystem<T extends typeof SystemImpl<any>>(system: T): InstanceType<T>;
  getSystemsByType(type: SchemaRef, entity?: number): SystemImpl<any>[];
  destroy(): void;
};

export interface LeanGameModelOptions {
  /** A lean world spec or type, or an existing world. Default: an empty lean world. */
  world?: LeanWorldSpec | LeanWorldType | World;
  roomId?: string;
  seed?: string;
  inputManager?: InputManager;
}

const schemaOf = (world: World, type: SchemaRef): typeof Schema | undefined => {
  const schema = (typeof type === "string" ? getComponentByType(type) : type) as typeof Schema | undefined;
  return schema && isComponentRegistered(world, schema as any) ? schema : undefined;
};

export const createLeanGameModel = (options: LeanGameModelOptions = {}): LeanGameModel => {
  const source = options.world;
  const world: World =
    typeof source === "function" ? (source as World) : source && "create" in source ? source.create() : leanWorldType(source ?? {}).create();

  const model = Object.assign(world, {
    inputManager: options.inputManager,
    roomId: options.roomId ?? "",
    seed: options.seed ?? "",
    localNetIds: [] as string[],
    paused: false,
    destroyed: false,
    timeElapsed: 0,
    frameDt: FIXED_TIMESTEP_MS,
    coreEntity: -1,
    step(dt?: number) {
      if (model.paused || model.destroyed) return;
      const elapsed = dt ?? FIXED_TIMESTEP_MS;
      model.timeElapsed += elapsed;
      model.frameDt = elapsed;
      stepWorld(world);
    },
    stepDraw() {
      if (!model.destroyed) stepWorldDraw(world);
    },
    run(dt?: number) {
      model.step(dt);
      model.stepDraw();
    },
    addEntity: () => addEntity(world),
    removeEntity: (entity: number) => {
      if (entityExists(world, entity)) removeEntity(world, entity);
    },
    isActive: (entity: number) => entityExists(world, entity),
    addComponent<T extends Schema>(type: SchemaRef<T>, entity: number, overrides?: Partial<T>, reset?: boolean) {
      const schema = (typeof type === "string" ? getComponentByType(type) : type) as Constructor<T> | undefined;
      if (!schema) throw new Error(`yage LeanGameModel: unknown component ${String(type)}`);
      addComponent(world, schema, entity, overrides as any, reset);
    },
    removeComponent<T extends Schema>(type: SchemaRef<T>, entity: number) {
      const schema = schemaOf(world, type);
      if (schema) removeComponent(world, schema, entity);
    },
    hasComponent<T extends Schema>(type: SchemaRef<T>, entity: number) {
      const schema = schemaOf(world, type);
      return !!schema && hasComponent(world, schema as any, entity);
    },
    getTypedUnsafe: <T extends Schema>(type: Constructor<T>, entity: number) => world(type, entity) as T,
    getTyped<T extends Schema>(type: Constructor<T>, entity: number) {
      return model.hasComponent(type, entity) ? (world(type, entity) as T) : null;
    },
    getComponent<T extends Schema>(type: SchemaRef<T>, entity: number) {
      const schema = schemaOf(world, type);
      return schema && hasComponent(world, schema as any, entity) ? (world(schema as any, entity) as T) : null;
    },
    getComponentActives(type: SchemaRef) {
      const schema = schemaOf(world, type);
      return schema ? (defineQuery([schema])(world) as number[]) : [];
    },
    getSystem: <T extends typeof SystemImpl<any>>(system: T) => getSystem(world, system) as InstanceType<T>,
    getSystemsByType(type: SchemaRef, entity?: number) {
      const name = typeof type === "string" ? type : (type as typeof Schema).type;
      // minecs returns one entry per query key, each the systems sharing that query.
      const systems = (getSystemsByType(world, name) as unknown as (SystemImpl<any> | SystemImpl<any>[])[]).flat().sort(
        (a, b) => (a.constructor as typeof SystemImpl).depth - (b.constructor as typeof SystemImpl).depth
      );
      return entity === undefined ? systems : systems.filter((system) => system.query.has(world, entity));
    },
    destroy() {
      if (model.destroyed) return;
      // Remove entities first (newest first, like GameModel) so systems' cleanup hooks run.
      for (const entity of [...world.entitySparseSet.dense].sort((a, b) => b - a)) if (entityExists(world, entity)) removeEntity(world, entity);
      deleteWorld(world);
      model.destroyed = true;
    },
  });
  Object.defineProperty(model, "players", { get: () => model.getComponentActives("PlayerType"), enumerable: true });
  return model as unknown as LeanGameModel;
};
