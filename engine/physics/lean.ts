/**
 * Lean physics: Rapier for lean worlds (yage/world/lean), without GameModel, a core entity,
 * AssetLoader or Pixi. Meant for simulations that run in workers or on a server, such as the
 * chunks of a streamed world while a client watches them closely.
 *
 * Import it as `yage/physics/lean`. Rapier's deterministic build inlines its wasm, so
 * `loadRapier()` works in a worker or in node.
 *
 * - LeanBody: a per-entity body (a circle, or a box when radius is 0). Every step the body heads
 *   for the entity's position columns: dynamic bodies at a velocity (capped by maxSpeed), and
 *   kinematic ones exactly. The resolved position is written back. Off bodies only follow along.
 *   Entities keep their own movement logic, and Rapier only resolves contact.
 * - LeanPhysics: the per-world resource (the Rapier world, body handles and fixed colliders). Add
 *   it to the world's context spec (yage/world/lean) and call releaseLeanPhysicsState from the
 *   spec's dispose, so the Rapier world is freed with the lean world.
 * - LeanPhysicsSystem: the system that steps it, subclassed by the game with its position
 *   columns. It only steps on steps the game armed with armLeanPhysics, so other steps of the
 *   same world (cheaper tiers, tests) never touch Rapier.
 */
import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import { Component, defaultValue, nullable, Schema, SystemImpl, type, type World } from "minecs";
import { worldContext } from "../world/context";

// -------------------------------------------------------------------------------------------
// Loading

let loading: Promise<typeof RAPIER> | null = null;
let loaded = false;

/** Loads Rapier once per process (safe to call again). Await it before arming any world. */
export const loadRapier = (): Promise<typeof RAPIER> =>
  (loading ??= RAPIER.init().then(() => {
    loaded = true;
    return RAPIER;
  }));

/** Whether loadRapier has finished. */
export const rapierLoaded = (): boolean => loaded;

// -------------------------------------------------------------------------------------------
// Schemas

/** How a body moves this step. */
export enum LeanBodyKind {
  /** Heads for the entity's position at a velocity and is pushed by contact. */
  Dynamic = 0,
  /** Goes exactly to the entity's position. It pushes others, and nothing pushes it. */
  Kinematic = 1,
  /** No contact at all: the body only follows the entity's position. */
  Off = 2,
}

@Component("LeanBody")
export class LeanBody extends Schema {
  /** Circle radius. 0 makes the body a box of half extents hw × hh. */
  @type("float32")
  @defaultValue(0)
  radius: number;

  @type("float32")
  @defaultValue(0)
  hw: number;

  @type("float32")
  @defaultValue(0)
  hh: number;

  /** LeanBodyKind. The game may change it between steps. */
  @type("uint8")
  @defaultValue(LeanBodyKind.Dynamic)
  kind: number;

  /** Top speed (units per second) a dynamic body heads for its position at. 0 means no cap. */
  @type("float32")
  @defaultValue(0)
  maxSpeed: number;

  /**
   * How far (in units) a dynamic body may fall behind its position before it passes through
   * fixed colliders to catch up. It collides with them again once it is within a quarter of
   * that. 0 means it never passes through.
   */
  @type("float32")
  @defaultValue(0)
  slack: number;

  /**
   * Rapier dominance group (-127..127): a body is never pushed by bodies of a lower group, and
   * pushes them as a kinematic body would. Equal groups push each other.
   */
  @type("int8")
  @defaultValue(0)
  dominance: number;

  /** Output: the share of last step's way to its position the body made (1 when it was already there). */
  @type("float32")
  @defaultValue(1)
  reach: number;
}

type BodyEntry = { body: RAPIER.RigidBody; collider: RAPIER.Collider; kind: number; ghost: boolean; dominance: number };

@Component("LeanPhysics")
export class LeanPhysics extends Schema {
  /** The Rapier world while armed, else null. */
  @nullable()
  @type("object")
  world: RAPIER.World | null;

  /** Bodies by entity. */
  @nullable()
  @type("object")
  bodies: Map<number, BodyEntry> | null;

  /** Fixed colliders added since the world was built. */
  @type("number")
  @defaultValue(0)
  fixed: number;

  /** The armed step's length in seconds. 0 means not armed. */
  @type("number")
  @defaultValue(0)
  dt: number;

  /** Longest Rapier substep, in seconds. */
  @type("number")
  @defaultValue(0.1)
  maxStep: number;
}

// -------------------------------------------------------------------------------------------
// Resource lifecycle

/** Membership and filter bits: fixed colliders, then bodies. */
const FIXED = 0x0001;
const BODY = 0x0002;
const groups = (membership: number, filter: number) => (membership << 16) | filter;
const SOLID_BODY = groups(BODY, FIXED | BODY);
const GHOST_BODY = groups(BODY, BODY);
const FIXED_GROUPS = groups(FIXED, BODY);

let live = 0;

/** Rapier worlds made by lean physics and not freed yet (for leak checks). */
export const liveLeanPhysicsWorlds = (): number => live;

/** The world's lean physics resource. The world's context spec must list LeanPhysics. */
export const leanPhysicsOf = (world: World): LeanPhysics => worldContext(world, LeanPhysics);

export type ArmOptions = {
  /** Seconds this step covers. */
  dt: number;
  /** Adds the fixed colliders (addFixedBox) when the Rapier world is first made. */
  build?: (state: LeanPhysics) => void;
  /** Longest Rapier substep, in seconds. Default 0.1. */
  maxStep?: number;
};

/**
 * Arms the next run of the world's lean physics system for a step of `dt` seconds, making the
 * Rapier world (and calling `build`) on first use. Returns false, arming nothing, until
 * loadRapier has finished.
 */
export const armLeanPhysics = (world: World, options: ArmOptions): boolean => {
  if (!loaded) return false;
  const state = leanPhysicsOf(world);
  if (!state.world) {
    state.world = new RAPIER.World({ x: 0, y: 0 });
    state.bodies = new Map();
    state.fixed = 0;
    live++;
    try {
      options.build?.(state);
    } catch (error) {
      releaseLeanPhysicsState(state);
      throw error;
    }
  }
  state.dt = options.dt;
  state.maxStep = options.maxStep ?? 0.1;
  return true;
};

/** Whether the world has a live Rapier world. */
export const leanPhysicsLive = (world: World): boolean => !!leanPhysicsOf(world).world;

/** Frees the resource's Rapier world and forgets its bodies. Safe to call when nothing is live. */
export const releaseLeanPhysicsState = (state: LeanPhysics): void => {
  const physics = state.world;
  state.world = null;
  state.bodies = null;
  state.fixed = 0;
  state.dt = 0;
  if (physics) {
    live--;
    physics.free();
  }
};

/** Frees the world's Rapier world (for example when its tier no longer simulates contact). */
export const releaseLeanPhysics = (world: World): void => releaseLeanPhysicsState(leanPhysicsOf(world));

/** Adds a fixed box centred at (x, y), turned by `angle` radians. Only while building or armed. */
export const addFixedBox = (state: LeanPhysics, x: number, y: number, hw: number, hh: number, angle = 0): void => {
  const physics = state.world;
  if (!physics) throw new Error("yage lean physics: addFixedBox needs a live world (armLeanPhysics)");
  const body = physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y).setRotation(angle));
  physics.createCollider(RAPIER.ColliderDesc.cuboid(hw, hh).setCollisionGroups(FIXED_GROUPS).setFriction(0), body);
  state.fixed++;
};

// -------------------------------------------------------------------------------------------
// Stepping

/** Where an entity's position lives: its component and its x and y fields. */
export type LeanPosition = { component: typeof Schema; x: string; y: string };

const bodyTypeOf = (kind: number) => (kind === LeanBodyKind.Dynamic ? RAPIER.RigidBodyType.Dynamic : RAPIER.RigidBodyType.KinematicPositionBased);

const createBody = (physics: RAPIER.World, shape: any, eid: number, x: number, y: number): BodyEntry => {
  const kind = shape.kind[eid];
  const dominance = shape.dominance[eid];
  const desc = new RAPIER.RigidBodyDesc(bodyTypeOf(kind)).setTranslation(x, y).lockRotations().setDominanceGroup(dominance);
  const body = physics.createRigidBody(desc);
  const radius = shape.radius[eid];
  const colliderDesc = radius > 0 ? RAPIER.ColliderDesc.ball(radius) : RAPIER.ColliderDesc.cuboid(Math.max(shape.hw[eid], 1e-3), Math.max(shape.hh[eid], 1e-3));
  const collider = physics.createCollider(colliderDesc.setCollisionGroups(SOLID_BODY).setFriction(0), body);
  if (kind === LeanBodyKind.Off) collider.setEnabled(false);
  return { body, collider, kind, ghost: false, dominance };
};

const setKind = (entry: BodyEntry, kind: number) => {
  if (entry.kind === kind) return;
  const wasDynamic = entry.kind === LeanBodyKind.Dynamic;
  if (wasDynamic !== (kind === LeanBodyKind.Dynamic)) entry.body.setBodyType(bodyTypeOf(kind), true);
  if ((entry.kind === LeanBodyKind.Off) !== (kind === LeanBodyKind.Off)) entry.collider.setEnabled(kind !== LeanBodyKind.Off);
  if (kind !== LeanBodyKind.Dynamic) entry.body.setLinvel({ x: 0, y: 0 }, false);
  entry.kind = kind;
};

const byNumber = (a: number, b: number) => a - b;

/**
 * Steps the world's bodies once: creates the missing ones (in entity order, so runs repeat
 * exactly), heads each for its entity's position, runs Rapier, and writes the resolved
 * positions back. Called by the game's LeanPhysicsSystem on armed steps.
 */
export const stepLeanPhysics = (world: World, position: LeanPosition, entities: readonly number[]): void => {
  const state = leanPhysicsOf(world);
  const physics = state.world;
  const dt = state.dt;
  state.dt = 0;
  if (!physics || !(dt > 0)) return;
  const bodies = state.bodies!;
  const shape = world(LeanBody).store as any;
  const store = (world as any)(position.component).store;
  const xs: Float32Array | Float64Array = store[position.x];
  const ys: Float32Array | Float64Array = store[position.y];

  const substeps = Math.max(1, Math.ceil(dt / state.maxStep - 1e-9));
  const sorted = entities.slice().sort(byNumber);
  const n = sorted.length;
  // Where each body started this step, and its way to the entity's position.
  const from = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    const eid = sorted[i];
    const x = xs[eid];
    const y = ys[eid];
    let entry = bodies.get(eid);
    if (!entry) {
      entry = createBody(physics, shape, eid, x, y);
      bodies.set(eid, entry);
    }
    const kind = shape.kind[eid];
    setKind(entry, kind);
    const dominance = shape.dominance[eid];
    if (entry.dominance !== dominance) {
      entry.body.setDominanceGroup(dominance);
      entry.dominance = dominance;
    }
    const at = entry.body.translation();
    from[i * 4] = at.x;
    from[i * 4 + 1] = at.y;
    const dx = x - at.x;
    const dy = y - at.y;
    from[i * 4 + 2] = dx;
    from[i * 4 + 3] = dy;
    if (kind === LeanBodyKind.Off) {
      entry.body.setTranslation({ x, y }, false);
      continue;
    }
    if (kind === LeanBodyKind.Kinematic) {
      entry.body.setNextKinematicTranslation({ x, y });
      continue;
    }
    const distance = Math.sqrt(dx * dx + dy * dy);
    const slack = shape.slack[eid];
    if (slack > 0) {
      const ghost = entry.ghost ? distance > slack * 0.25 : distance > slack;
      if (ghost !== entry.ghost) {
        entry.ghost = ghost;
        entry.collider.setCollisionGroups(ghost ? GHOST_BODY : SOLID_BODY);
      }
    } else if (entry.ghost) {
      entry.ghost = false;
      entry.collider.setCollisionGroups(SOLID_BODY);
    }
    let speed = distance / dt;
    const cap = shape.maxSpeed[eid];
    if (cap > 0 && speed > cap) speed = cap;
    const scale = distance > 0 ? speed / distance : 0;
    entry.body.setLinvel({ x: dx * scale, y: dy * scale }, true);
    // Contact is predicted as far as the body goes in a substep, so a quick body stops at a wall
    // instead of sinking into it and being pushed back out over the next steps.
    entry.body.setSoftCcdPrediction((speed * dt) / substeps);
  }

  physics.timestep = dt / substeps;
  for (let s = 0; s < substeps; s++) physics.step();

  for (let i = 0; i < n; i++) {
    const eid = sorted[i];
    const entry = bodies.get(eid)!;
    if (entry.kind !== LeanBodyKind.Dynamic) {
      shape.reach[eid] = 1;
      continue;
    }
    const at = entry.body.translation();
    entry.body.setLinvel({ x: 0, y: 0 }, false);
    const dx = from[i * 4 + 2];
    const dy = from[i * 4 + 3];
    const want = dx * dx + dy * dy;
    shape.reach[eid] = want > 1e-12 ? ((at.x - from[i * 4]) * dx + (at.y - from[i * 4 + 1]) * dy) / want : 1;
    xs[eid] = at.x;
    ys[eid] = at.y;
  }
};

/** Removes an entity's body, if it has one (LeanPhysicsSystem does it when the entity goes). */
export const removeLeanBody = (world: World, eid: number): void => {
  let state: LeanPhysics;
  try {
    state = leanPhysicsOf(world);
  } catch {
    // The world's context is already gone (the world is being deleted); its Rapier world with it.
    return;
  }
  const entry = state.bodies?.get(eid);
  if (!entry || !state.world) return;
  state.world.removeRigidBody(entry.body);
  state.bodies!.delete(eid);
};

/**
 * The system that steps a world's lean physics. A game subclasses it once, bound to its own
 * position component, and lists it with the world's systems:
 *
 *   @System(LeanBody, Pos)
 *   export class MyPhysicsSystem extends LeanPhysicsSystem {
 *     static depth = 90;
 *     static position = { component: Pos, x: "x", y: "y" };
 *   }
 */
export class LeanPhysicsSystem extends SystemImpl<World> {
  /** The position columns bodies head for and are written back to. */
  static position: LeanPosition;
  static runEmpty = true;
  cleanup(world: World, eid: number) {
    removeLeanBody(world, eid);
  }
  runAll(world: World) {
    const position = (this.constructor as typeof LeanPhysicsSystem).position;
    if (!position) throw new Error(`yage lean physics: ${this.constructor.name} has no static position`);
    stepLeanPhysics(world, position, this.query(world));
  }
}
