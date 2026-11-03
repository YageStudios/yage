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
 * - Guards: a body that becomes dynamic inside a fixed collider (which can stall Rapier's step
 *   for good) is moved to the nearest free spot, or let off walls until clear of them, and a step
 *   over budget is logged; each logged once per process (leanPhysicsGuards counts them).
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

type BodyEntry = {
  body: RAPIER.RigidBody;
  /**
   * Null while the body is off: Rapier keeps even a disabled collider in its query tree, and a
   * crowd of them on one spot (people parked in one room) makes the tree's rebuild take seconds
   * to minutes, a freeze with no error.
   */
  collider: RAPIER.Collider | null;
  kind: number;
  ghost: boolean;
  dominance: number;
  /** Became dynamic inside fixed colliders with no free spot near: meets bodies only until it is clear of them. */
  stuck: boolean;
  /**
   * While off, where the entity is: the body (no collider, so it meets nothing) is moved there
   * only when it turns back on, not every step, so Rapier is not handed a moved body per step.
   */
  offX: number;
  offY: number;
  /** Where a kinematic body was last sent (NaN until it is): a body that stays put is not sent again. */
  kinX: number;
  kinY: number;
};

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

  /** `fixed` when the query structures last took in the fixed colliders (a step does it). */
  @type("number")
  @defaultValue(0)
  synced: number;

  /** The armed step's length in seconds. 0 means not armed. */
  @type("number")
  @defaultValue(0)
  dt: number;

  /** Longest Rapier substep, in seconds. */
  @type("number")
  @defaultValue(0.1)
  maxStep: number;

  /** The armed step's ground speed: a factor on a dynamic body's speed where it stands (ArmOptions.speedAt). */
  @nullable()
  @type("object")
  speedAt: ((x: number, y: number) => number) | null;
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
/** A query that meets fixed colliders (walls) only, never bodies. */
const WALLS_ONLY = groups(BODY, FIXED);

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
  /**
   * Ground speed: a factor (1 full speed, 0.5 half) on how fast a dynamic body may go where it
   * stands at the start of the step, per tile or per anything else the game keeps (wading, mud,
   * snow). It scales the body's capped speed, so a slowed body falls behind its position (its
   * `reach` says by how much). Kinematic bodies are not slowed. Default: none (always 1).
   */
  speedAt?: (x: number, y: number) => number;
};

/**
 * A ground speed over a tile grid (ArmOptions.speedAt): `tiles` row-major, `columns` wide, each
 * tile `size` units square with its top-left at (`x0`, `y0`); `speed[tile]` the factor for that
 * tile value (missing values, and points off the grid, go at full speed).
 */
export const tileSpeed = (tiles: ArrayLike<number>, columns: number, size: number, speed: ArrayLike<number | undefined>, x0 = 0, y0 = 0) => {
  const rows = Math.floor(tiles.length / columns);
  return (x: number, y: number): number => {
    const i = Math.floor((x - x0) / size), j = Math.floor((y - y0) / size);
    if (i < 0 || j < 0 || i >= columns || j >= rows) return 1;
    return speed[tiles[j * columns + i]] ?? 1;
  };
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
    state.synced = 0;
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
  state.speedAt = options.speedAt ?? null;
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
  state.synced = 0;
  state.dt = 0;
  state.speedAt = null;
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
  if (![x, y, hw, hh, angle].every(Number.isFinite) || hw <= 0 || hh <= 0) {
    guards.badBoxes++;
    if (!warnedBadBox) {
      warnedBadBox = true;
      console.warn(`yage lean physics: fixed box (${x}, ${y}) half ${hw} × ${hh} angle ${angle} skipped: not a finite box with positive extents. Logged once.`);
    }
    return;
  }
  const body = physics.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(x, y).setRotation(angle));
  physics.createCollider(RAPIER.ColliderDesc.cuboid(hw, hh).setCollisionGroups(FIXED_GROUPS).setFriction(0), body);
  state.fixed++;
};

// -------------------------------------------------------------------------------------------
// Casting

const balls = new Map<number, RAPIER.Ball>();

/**
 * The share (0…1) of the move (dx, dy) a ball of `radius` at (x, y) makes straight before it meets
 * a fixed collider; bodies are not met, and 1 means nothing is in the way. A ball already touching
 * a wall and moving off or along it is not stopped by it.
 */
export const castBall = (physics: RAPIER.World, x: number, y: number, radius: number, dx: number, dy: number): number => {
  let ball = balls.get(radius);
  if (!ball) balls.set(radius, (ball = new RAPIER.Ball(radius)));
  const hit = physics.castShape({ x, y }, 0, { x: dx, y: dy }, ball, 0, 1, false, undefined, WALLS_ONLY);
  return hit ? Math.max(0, Math.min(1, hit.time_of_impact)) : 1;
};

/** castBall in the world's armed Rapier world; 1 (nothing in the way) while it has none. */
export const leanCast = (world: World, x: number, y: number, radius: number, dx: number, dy: number): number => {
  const physics = leanPhysicsOf(world).world;
  return physics ? castBall(physics, x, y, radius, dx, dy) : 1;
};

// -------------------------------------------------------------------------------------------
// Stepping

/** Where an entity's position lives: its component and its x and y fields. */
export type LeanPosition = { component: typeof Schema; x: string; y: string };

const bodyTypeOf = (kind: number) => (kind === LeanBodyKind.Dynamic ? RAPIER.RigidBodyType.Dynamic : RAPIER.RigidBodyType.KinematicPositionBased);

const colliderFor = (physics: RAPIER.World, shape: any, eid: number, body: RAPIER.RigidBody, groups: number): RAPIER.Collider => {
  const radius = shape.radius[eid];
  const desc = radius > 0 ? RAPIER.ColliderDesc.ball(radius) : RAPIER.ColliderDesc.cuboid(Math.max(shape.hw[eid], 1e-3), Math.max(shape.hh[eid], 1e-3));
  return physics.createCollider(desc.setCollisionGroups(groups).setFriction(0), body);
};

const createBody = (physics: RAPIER.World, shape: any, eid: number, x: number, y: number): BodyEntry => {
  const kind = shape.kind[eid];
  const dominance = shape.dominance[eid];
  const desc = new RAPIER.RigidBodyDesc(bodyTypeOf(kind)).setTranslation(x, y).lockRotations().setDominanceGroup(dominance);
  const body = physics.createRigidBody(desc);
  const collider = kind === LeanBodyKind.Off ? null : colliderFor(physics, shape, eid, body, SOLID_BODY);
  return { body, collider, kind, ghost: false, dominance, stuck: false, offX: x, offY: y, kinX: NaN, kinY: NaN };
};

// -------------------------------------------------------------------------------------------
// Guards

/**
 * A dynamic body that starts inside fixed colliders can stall Rapier's step for good (pressed
 * between walls it never resolves), freezing the thread with no error. So a body that becomes
 * dynamic inside a wall is moved to the nearest free spot first, searched in rings outward in a
 * fixed order (runs repeat exactly); with none near, it is let off walls (it meets bodies only)
 * until it is clear of them. Each is logged once per process.
 */
const guards = { nudged: 0, stuck: 0, slowSteps: 0, badBoxes: 0 };
let warnedBadBox = false;
let warnedNudge = false;
let warnedStuck = false;
let warnedSlow = false;
let stepBudgetMs = 100;

/** How often the guards fired in this process: bodies moved out of walls, bodies let off walls, steps over budget. */
export const leanPhysicsGuards = (): Readonly<typeof guards> => ({ ...guards });

/**
 * Sets the time (ms) a world's step may take before it is logged (once per process). Default 100.
 * The clock only decides the log; it never changes what the step does.
 */
export const setLeanStepBudget = (ms: number): void => {
  stepBudgetMs = ms;
  warnedSlow = false;
};

const RINGS = 16;

/** Overlap a body's step resolves on its own (a share of its size): only deeper counts as inside a wall. */
const SHALLOW = 0.01;
const cores = new Map<string, RAPIER.Shape>();

/** The body's shape less the shallow overlap: touching a wall, or just into it, is not inside it. */
const coreOf = (shape: any, eid: number): RAPIER.Shape => {
  const radius = shape.radius[eid];
  const key = radius > 0 ? `b${radius}` : `c${shape.hw[eid]},${shape.hh[eid]}`;
  let core = cores.get(key);
  if (!core) {
    const keep = 1 - SHALLOW;
    core = radius > 0 ? new RAPIER.Ball(radius * keep) : new RAPIER.Cuboid(Math.max(shape.hw[eid], 1e-3) * keep, Math.max(shape.hh[eid], 1e-3) * keep);
    cores.set(key, core);
  }
  return core;
};

/** The shape at (x, y) is inside a fixed collider. */
const inWall = (physics: RAPIER.World, core: RAPIER.Shape, x: number, y: number): boolean =>
  physics.intersectionWithShape({ x, y }, 0, core, undefined, WALLS_ONLY) !== null;

/** The nearest spot clear of fixed colliders around (x, y), rings outward in a fixed order; null when none is near. */
const freeSpot = (physics: RAPIER.World, core: RAPIER.Shape, size: number, x: number, y: number): { x: number; y: number } | null => {
  const gap = Math.max(size, 0.05) * 0.5;
  for (let ring = 1; ring <= RINGS; ring++) {
    const r = ring * gap;
    const around = 8 * ring;
    for (let k = 0; k < around; k++) {
      const a = (k / around) * Math.PI * 2;
      const cx = x + Math.cos(a) * r;
      const cy = y + Math.sin(a) * r;
      if (!inWall(physics, core, cx, cy)) return { x: cx, y: cy };
    }
  }
  return null;
};

/** A body just made dynamic: out of any wall it is in (see guards above). */
const clearOfWalls = (physics: RAPIER.World, entry: BodyEntry, shape: any, eid: number, at: { x: number; y: number }): { x: number; y: number } => {
  const core = coreOf(shape, eid);
  if (!entry.collider || !inWall(physics, core, at.x, at.y)) return at;
  const size = shape.radius[eid] > 0 ? shape.radius[eid] : Math.max(shape.hw[eid], shape.hh[eid]);
  const spot = freeSpot(physics, core, size, at.x, at.y);
  if (spot) {
    entry.body.setTranslation(spot, false);
    guards.nudged++;
    if (!warnedNudge) {
      warnedNudge = true;
      console.warn(`yage lean physics: entity ${eid} became dynamic inside a fixed collider at (${at.x.toFixed(2)}, ${at.y.toFixed(2)}); moved to the nearest free spot (${spot.x.toFixed(2)}, ${spot.y.toFixed(2)}). Logged once.`);
    }
    return entry.body.translation();
  }
  entry.stuck = true;
  entry.collider!.setCollisionGroups(GHOST_BODY);
  guards.stuck++;
  if (!warnedStuck) {
    warnedStuck = true;
    console.warn(`yage lean physics: entity ${eid} became dynamic inside fixed colliders at (${at.x.toFixed(2)}, ${at.y.toFixed(2)}) with no free spot within ${RINGS} rings; it passes through walls until it is clear of them. Logged once.`);
  }
  return at;
};

/** Puts fixed colliders added since the last step into the query structures: a step of no time, which moves nothing. */
const syncQueries = (state: LeanPhysics, physics: RAPIER.World) => {
  if (state.synced === state.fixed) return;
  physics.timestep = 0;
  physics.step();
  state.synced = state.fixed;
};

const setKind = (physics: RAPIER.World, shape: any, eid: number, entry: BodyEntry, kind: number) => {
  if (entry.kind === kind) return;
  const wasDynamic = entry.kind === LeanBodyKind.Dynamic;
  if (wasDynamic !== (kind === LeanBodyKind.Dynamic)) entry.body.setBodyType(bodyTypeOf(kind), true);
  if (kind === LeanBodyKind.Off && entry.collider) {
    physics.removeCollider(entry.collider, false);
    entry.collider = null;
  } else if (kind !== LeanBodyKind.Off && !entry.collider) entry.collider = colliderFor(physics, shape, eid, entry.body, entry.ghost || entry.stuck ? GHOST_BODY : SOLID_BODY);
  if (kind !== LeanBodyKind.Dynamic) entry.body.setLinvel({ x: 0, y: 0 }, false);
  entry.kinX = NaN;
  entry.kinY = NaN;
  entry.kind = kind;
};

const byNumber = (a: number, b: number) => a - b;

/**
 * Sets a body's velocity through one reused raw vector: RigidBody.setLinvel makes and frees a
 * wasm vector per call, which at a few hundred calls a step costs more than the call itself.
 */
let linvel: ReturnType<typeof RAPIER.VectorOps.intoRaw> | null = null;
const setLinvel = (body: RAPIER.RigidBody, x: number, y: number, wake: boolean) => {
  linvel ??= RAPIER.VectorOps.intoRaw({ x: 0, y: 0 });
  linvel.x = x;
  linvel.y = y;
  (body as any).rawSet.rbSetLinvel(body.handle, linvel, wake);
};

/**
 * Steps the world's bodies once: creates the missing ones (in entity order, so runs repeat
 * exactly), heads each for its entity's position, runs Rapier, and writes the resolved
 * positions back. Called by the game's LeanPhysicsSystem on armed steps.
 */
export const stepLeanPhysics = (world: World, position: LeanPosition, entities: readonly number[]): void => {
  const state = leanPhysicsOf(world);
  const physics = state.world;
  const dt = state.dt;
  const speedAt = state.speedAt;
  state.dt = 0;
  state.speedAt = null;
  if (!physics || !(dt > 0)) return;
  const bodies = state.bodies!;
  const shape = world(LeanBody).store as any;
  const store = (world as any)(position.component).store;
  const xs: Float32Array | Float64Array = store[position.x];
  const ys: Float32Array | Float64Array = store[position.y];

  const substeps = Math.max(1, Math.ceil(dt / state.maxStep - 1e-9));
  const sorted = entities.slice().sort(byNumber);
  syncQueries(state, physics);
  const n = sorted.length;
  // Where each body started this step, and its way to the entity's position.
  const from = new Float64Array(n * 4);
  for (let i = 0; i < n; i++) {
    const eid = sorted[i];
    const x = xs[eid];
    const y = ys[eid];
    if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error(`Invalid physics position for entity ${eid}: ${x}, ${y} (kind ${shape.kind[eid]})`);
    let entry = bodies.get(eid);
    const kind = shape.kind[eid];
    let becameDynamic = kind === LeanBodyKind.Dynamic;
    if (!entry) {
      entry = createBody(physics, shape, eid, x, y);
      bodies.set(eid, entry);
    } else becameDynamic &&= entry.kind !== LeanBodyKind.Dynamic;
    if (entry.kind === LeanBodyKind.Off && kind !== LeanBodyKind.Off) entry.body.setTranslation({ x: entry.offX, y: entry.offY }, false);
    setKind(physics, shape, eid, entry, kind);
    // Where a dynamic body is now (read once: each read crosses into wasm and makes a vector).
    let at: { x: number; y: number } | null = null;
    if (entry.stuck && (kind !== LeanBodyKind.Dynamic || !inWall(physics, coreOf(shape, eid), (at = entry.body.translation()).x, at.y))) {
      entry.stuck = false;
      entry.collider?.setCollisionGroups(entry.ghost ? GHOST_BODY : SOLID_BODY);
    }
    const dominance = shape.dominance[eid];
    if (entry.dominance !== dominance) {
      entry.body.setDominanceGroup(dominance);
      entry.dominance = dominance;
    }
    if (kind === LeanBodyKind.Dynamic && !entry.stuck) {
      // Passing through walls past its slack, or back on them (maybe inside one).
      const was = entry.ghost;
      const slack = shape.slack[eid];
      if (slack > 0) {
        const pre = (at ??= entry.body.translation());
        const far = Math.sqrt((x - pre.x) * (x - pre.x) + (y - pre.y) * (y - pre.y));
        entry.ghost = entry.ghost ? far > slack * 0.25 : far > slack;
      } else entry.ghost = false;
      if (entry.ghost !== was) entry.collider!.setCollisionGroups(entry.ghost ? GHOST_BODY : SOLID_BODY);
      if (!entry.ghost && (becameDynamic || was)) at = clearOfWalls(physics, entry, shape, eid, at ?? entry.body.translation());
    }
    // Off and kinematic bodies go straight to the entity's position (their start is never read).
    if (kind === LeanBodyKind.Off) {
      entry.offX = x;
      entry.offY = y;
      continue;
    }
    if (kind === LeanBodyKind.Kinematic) {
      // One that stays put is left alone: Rapier then treats it as still and wakes nothing round it.
      if (x !== entry.kinX || y !== entry.kinY) {
        entry.body.setNextKinematicTranslation({ x, y });
        entry.kinX = x;
        entry.kinY = y;
      }
      continue;
    }
    at ??= entry.body.translation();
    from[i * 4] = at.x;
    from[i * 4 + 1] = at.y;
    const dx = x - at.x;
    const dy = y - at.y;
    from[i * 4 + 2] = dx;
    from[i * 4 + 3] = dy;
    const distance = Math.sqrt(dx * dx + dy * dy);
    let speed = distance / dt;
    const cap = shape.maxSpeed[eid];
    if (cap > 0 && speed > cap) speed = cap;
    if (speedAt) speed *= Math.max(0, speedAt(at.x, at.y));
    const scale = distance > 0 ? speed / distance : 0;
    // Rapier wakes a body only when its velocity changes: one with nowhere to go (zero, as left after
    // the last step) is not woken, and sleeps once still a while, until a new way to go or a touch wakes it.
    setLinvel(entry.body, dx * scale, dy * scale, true);
    // Contact is predicted as far as the body goes in a substep, so a quick body stops at a wall
    // instead of sinking into it and being pushed back out over the next steps.
    entry.body.setSoftCcdPrediction((speed * dt) / substeps);
  }

  physics.timestep = dt / substeps;
  // The clock only decides the log below; the step is the same either way.
  const started = performance.now();
  for (let s = 0; s < substeps; s++) physics.step();
  state.synced = state.fixed;
  const took = performance.now() - started;
  if (took > stepBudgetMs) {
    guards.slowSteps++;
    if (!warnedSlow) {
      warnedSlow = true;
      console.warn(`yage lean physics: a step took ${took.toFixed(0)} ms (budget ${stepBudgetMs} ms): ${n} bodies, ${state.fixed} fixed colliders, ${substeps} substeps. Logged once.`);
    }
  }

  for (let i = 0; i < n; i++) {
    const eid = sorted[i];
    const entry = bodies.get(eid)!;
    if (entry.kind !== LeanBodyKind.Dynamic) {
      shape.reach[eid] = 1;
      continue;
    }
    const at = entry.body.translation();
    setLinvel(entry.body, 0, 0, false);
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

// -------------------------------------------------------------------------------------------
// Probing

/**
 * A ball swept through fixed colliders without stepping a world: for a client that draws an
 * entity ahead of the simulation (its own steering) and wants it to meet the same walls the
 * simulation's bodies do. `build` adds the fixed colliders (addFixedBox), as for armLeanPhysics.
 * Null until loadRapier has finished. Free it with `free()`.
 */
export type LeanProbe = {
  /** How far a ball of `radius` at (x, y) gets of the move (dx, dy): blocked part dropped, the rest slid along what it meets. */
  slide(x: number, y: number, radius: number, dx: number, dy: number): { x: number; y: number };
  /** castBall in the probe's walls. */
  cast(x: number, y: number, radius: number, dx: number, dy: number): number;
  free(): void;
};

export const createLeanProbe = (build: (state: LeanPhysics) => void): LeanProbe | null => {
  if (!loaded) return null;
  const physics = new RAPIER.World({ x: 0, y: 0 });
  const state = { world: physics, bodies: null, fixed: 0, synced: 0, dt: 0, maxStep: 0.1, speedAt: null } as LeanPhysics;
  live++;
  try {
    build(state);
  } catch (error) {
    releaseLeanPhysicsState(state);
    throw error;
  }
  // The fixed colliders into the query structures once.
  physics.timestep = 1 / 60;
  physics.step();
  // Top-down: no ground and no slopes, every surface met is slid along.
  const controller = physics.createCharacterController(0.01);
  controller.setSlideEnabled(true);
  controller.setMaxSlopeClimbAngle(Math.PI);
  controller.setMinSlopeSlideAngle(Math.PI);
  controller.disableSnapToGround();
  controller.disableAutostep();
  let ball: RAPIER.Collider | null = null;
  let ballRadius = -1;
  return {
    slide(x, y, radius, dx, dy) {
      if (ballRadius !== radius) {
        if (ball) physics.removeCollider(ball, false);
        ball = physics.createCollider(RAPIER.ColliderDesc.ball(radius).setCollisionGroups(SOLID_BODY));
        ballRadius = radius;
      }
      ball!.setTranslation({ x, y });
      controller.computeColliderMovement(ball!, { x: dx, y: dy }, undefined, SOLID_BODY);
      const moved = controller.computedMovement();
      return { x: moved.x, y: moved.y };
    },
    cast: (x, y, radius, dx, dy) => castBall(physics, x, y, radius, dx, dy),
    free() {
      controller.free();
      releaseLeanPhysicsState(state);
    },
  };
};
