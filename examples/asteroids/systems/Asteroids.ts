import { Component, defaultValue, DrawSystemImpl, QueryInstance, Schema, System, SystemImpl, type } from "minecs";
import type { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import { UIService } from "yage/ui/UIService";
import AssetLoader from "yage/loader/AssetLoader";
import type { UiMap } from "yage/ui/UiMap";
import { buildUiMap } from "yage/ui/UiMap";
import type { UIElement } from "yage/ui/UIElement";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { keyDown } from "yage/utils/keys";
import { EntityFactory } from "yage/entity/EntityFactory";
import { Transform } from "yage/schemas/entity/Transform";
import { Locomotion } from "yage/schemas/entity/Locomotion";
import { PixiGraphic } from "yage/schemas/render/PixiGraphic";
import { Collisions } from "yage/schemas/physics/Collisions";
import { RigidCircle } from "yage/schemas/physics/RigidCircle";
import { Health } from "yage/schemas/core/Health";
import { Owner } from "yage/schemas/core/Owner";
import { Damageable, Damage, DamageStats } from "yage/schemas/damage/DamageStats";
import { ComponentCategory, DamageCategoryEnum, DamageTypeEnum } from "yage/constants/enums";

// ── Constants ─────────────────────────────────────────────────────────────────

const FIELD_W = 800;
const FIELD_H = 600;
const FIELD_OFFSET_X = (1920 - FIELD_W) / 2;
const FIELD_OFFSET_Y = (1080 - FIELD_H) / 2;
const ROTATION_SPEED = 0.07;
const THRUST = 0.15;
const MAX_SPEED = 5;
const FRICTION = 0.99;
const FIRE_COOLDOWN = 10;
const BULLET_SPEED = 7;
const BULLET_LIFETIME = 50;
const INITIAL_ASTEROIDS = 4;
const INVINCIBILITY_FRAMES = 120;

const ASTEROID_RADII: Record<number, number> = { 3: 30, 2: 18, 1: 10 };
const ASTEROID_SCORE: Record<number, number> = { 3: 20, 2: 50, 1: 100 };

// ── Per-entity components ─────────────────────────────────────────────────────

@Component()
export class AsteroidsShipState extends Schema {
  @type("float32")
  @defaultValue(-Math.PI / 2)
  angle: number;

  @type("number")
  @defaultValue(0)
  fireCooldown: number;

  @type("number")
  @defaultValue(0)
  invincibility: number;

  @type("number")
  @defaultValue(0)
  score: number;
}

@Component()
export class AsteroidsBulletState extends Schema {
  @type("number")
  @defaultValue(BULLET_LIFETIME)
  lifetime: number;
}

@Component()
export class AsteroidsAsteroidState extends Schema {
  @type("number")
  @defaultValue(3)
  size: number; // 3 = large, 2 = medium, 1 = small
}

// ON_DEATH component — placed on asteroids so HealthSystem's runMods(ON_DEATH)
// dispatches to the split system when an asteroid dies.
@Component(ComponentCategory.ON_DEATH)
export class AsteroidsAsteroidSplitOnDeath extends Schema {
  @type("number")
  @defaultValue(-1)
  killedEntity: number; // populated by HealthSystem overrides
}

// ── Board component (read-only game session state, lives on core) ─────────────

@Component()
export class AsteroidsBoard extends Schema {
  @type("string")
  @defaultValue("PLAYING")
  status: string;

  @type("number")
  @defaultValue(1)
  level: number;

  @type("number")
  @defaultValue(-1)
  shipEntity: number;

  @type("string")
  @defaultValue("AsteroidsUI")
  uiMap: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function wrapField(val: number, min: number, max: number): number {
  const range = max - min;
  return ((((val - min) % range) + range) % range) + min;
}

function dist(x1: number, y1: number, x2: number, y2: number): number {
  const dx = x1 - x2;
  const dy = y1 - y2;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Construct a Damage object from an attacker's DamageStats and push it onto
 * the target's Damageable.damages array while decrementing target health.
 * This is the game-specific "damage applier" — the engine provides the schema
 * and the HealthSystem that reacts to health <= 0, but the actual application
 * of damage (constructing Damage, pushing, decrementing) is game code.
 */
function applyDamage(
  gameModel: GameModel,
  targetEntity: number,
  sourceEntity: number,
  ownerEntity: number,
  attackerStats: DamageStats,
): void {
  const damageable = gameModel.getTypedUnsafe(Damageable, targetEntity);
  const targetHealth = gameModel.getTypedUnsafe(Health, targetEntity);

  // Roll damage from the attacker's min/max range
  const dmg =
    attackerStats.minDamage === attackerStats.maxDamage
      ? attackerStats.minDamage
      : gameModel.rand.int(attackerStats.minDamage, attackerStats.maxDamage);

  // Build the Damage record
  const damage = {
    damageStats: attackerStats,
    owner: ownerEntity,
    source: sourceEntity,
    damage: dmg,
    damageCategory: DamageCategoryEnum.NONE,
    damageType: DamageTypeEnum.NORMAL,
    frame: gameModel.frame,
    critChance: attackerStats.critChance,
    critHit: false,
    damageScale: 1,
    knockback: 0,
  } as unknown as Damage;

  damageable.damages.push(damage);
  targetHealth.health -= dmg;
}

function createShip(gameModel: GameModel): number {
  const entity = EntityFactory.getInstance().generateEntity(gameModel, "AsteroidsShip");
  const t = gameModel.getTypedUnsafe(Transform, entity);
  t.x = FIELD_OFFSET_X + FIELD_W / 2;
  t.y = FIELD_OFFSET_Y + FIELD_H / 2;
  const state = gameModel.getTypedUnsafe(AsteroidsShipState, entity);
  state.invincibility = INVINCIBILITY_FRAMES;
  return entity;
}

function createBullet(gameModel: GameModel, ownerEntity: number, x: number, y: number, vx: number, vy: number): number {
  const entity = EntityFactory.getInstance().generateEntity(gameModel, "AsteroidsBullet");
  const t = gameModel.getTypedUnsafe(Transform, entity);
  t.x = x;
  t.y = y;
  const loco = gameModel.getTypedUnsafe(Locomotion, entity);
  loco.x = vx;
  loco.y = vy;
  const owner = gameModel.getTypedUnsafe(Owner, entity);
  owner.owner = ownerEntity;
  return entity;
}

function createAsteroid(gameModel: GameModel, x: number, y: number, vx: number, vy: number, size: number): number {
  const entity = EntityFactory.getInstance().generateEntity(gameModel, "AsteroidsAsteroid");
  const t = gameModel.getTypedUnsafe(Transform, entity);
  t.x = x;
  t.y = y;
  const loco = gameModel.getTypedUnsafe(Locomotion, entity);
  loco.x = vx;
  loco.y = vy;

  const radius = ASTEROID_RADII[size] ?? 10;
  const rc = gameModel.getTypedUnsafe(RigidCircle, entity);
  rc.radius = radius;
  const graphic = gameModel.getTypedUnsafe(PixiGraphic, entity);
  graphic.circle = { x: radius, y: radius, radius } as any;

  const state = gameModel.getTypedUnsafe(AsteroidsAsteroidState, entity);
  state.size = size;

  return entity;
}

function spawnAsteroidWave(count: number, gameModel: GameModel, avoidX: number, avoidY: number): void {
  for (let i = 0; i < count; i++) {
    let x: number, y: number;
    do {
      x = FIELD_OFFSET_X + gameModel.rand.float(0, FIELD_W);
      y = FIELD_OFFSET_Y + gameModel.rand.float(0, FIELD_H);
    } while (dist(x, y, avoidX, avoidY) < 120);

    const angle = gameModel.rand.float(0, Math.PI * 2);
    const speed = gameModel.rand.float(0.5, 2);
    createAsteroid(gameModel, x, y, Math.cos(angle) * speed, Math.sin(angle) * speed, 3);
  }
}

function resetShip(gameModel: GameModel, shipEntity: number): void {
  const t = gameModel.getTypedUnsafe(Transform, shipEntity);
  t.x = FIELD_OFFSET_X + FIELD_W / 2;
  t.y = FIELD_OFFSET_Y + FIELD_H / 2;
  const loco = gameModel.getTypedUnsafe(Locomotion, shipEntity);
  loco.x = 0;
  loco.y = 0;
  const state = gameModel.getTypedUnsafe(AsteroidsShipState, shipEntity);
  state.angle = -Math.PI / 2;
  state.invincibility = INVINCIBILITY_FRAMES;
}

function cleanAllEntities(gameModel: GameModel, board: AsteroidsBoard): void {
  for (const e of gameModel.getComponentActives("AsteroidsBulletState")) {
    gameModel.removeEntity(e);
  }
  for (const e of gameModel.getComponentActives("AsteroidsAsteroidState")) {
    gameModel.removeEntity(e);
  }
  if (board.shipEntity !== -1 && gameModel.isActive(board.shipEntity)) {
    gameModel.removeEntity(board.shipEntity);
    board.shipEntity = -1;
  }
}

function resetGame(board: AsteroidsBoard, gameModel: GameModel): void {
  cleanAllEntities(gameModel, board);

  board.level = 1;
  board.status = "PLAYING";

  board.shipEntity = createShip(gameModel);
  const health = gameModel.getTypedUnsafe(Health, board.shipEntity);
  health.health = health.maxHealth;
  const shipState = gameModel.getTypedUnsafe(AsteroidsShipState, board.shipEntity);
  shipState.score = 0;

  const shipT = gameModel.getTypedUnsafe(Transform, board.shipEntity);
  spawnAsteroidWave(INITIAL_ASTEROIDS, gameModel, shipT.x, shipT.y);
}

// ── Init System ───────────────────────────────────────────────────────────────

@System(AsteroidsBoard)
export class AsteroidsInitSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = -100;

  init = (gameModel: GameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(AsteroidsBoard, entity);
    resetGame(board, gameModel);
  };
}

// ── Ship System ───────────────────────────────────────────────────────────────

@System(AsteroidsShipState)
export class AsteroidsShipSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = 0;

  run = (gameModel: GameModel, entity: number) => {
    const boardEntities = gameModel.getComponentActives("AsteroidsBoard");
    if (boardEntities.length === 0) return;
    const board = gameModel.getTypedUnsafe(AsteroidsBoard, boardEntities[0]);
    if (board.status !== "PLAYING") return;

    const state = gameModel.getTypedUnsafe(AsteroidsShipState, entity);
    const transform = gameModel.getTypedUnsafe(Transform, entity);
    const loco = gameModel.getTypedUnsafe(Locomotion, entity);

    // Read input
    const playerEntities = gameModel.getComponentActives("PlayerInput");
    let rotating = 0;
    let thrusting = false;
    let firing = false;

    if (playerEntities.length > 0) {
      const pi = gameModel.getTypedUnsafe(PlayerInput, playerEntities[0]);
      if (pi.keyMap) {
        if (keyDown(["left", "a"], pi.keyMap)) rotating -= 1;
        if (keyDown(["right", "d"], pi.keyMap)) rotating += 1;
        if (keyDown(["up", "w"], pi.keyMap)) thrusting = true;
        if (keyDown(["space"], pi.keyMap)) firing = true;
      }
    }

    // Rotate
    state.angle += rotating * ROTATION_SPEED;

    // Thrust
    if (thrusting) {
      loco.x += Math.cos(state.angle) * THRUST;
      loco.y += Math.sin(state.angle) * THRUST;
      const speed = Math.sqrt(loco.x * loco.x + loco.y * loco.y);
      if (speed > MAX_SPEED) {
        loco.x = (loco.x / speed) * MAX_SPEED;
        loco.y = (loco.y / speed) * MAX_SPEED;
      }
    }

    // Friction
    loco.x *= FRICTION;
    loco.y *= FRICTION;

    // Wrap
    transform.x = wrapField(transform.x, FIELD_OFFSET_X, FIELD_OFFSET_X + FIELD_W);
    transform.y = wrapField(transform.y, FIELD_OFFSET_Y, FIELD_OFFSET_Y + FIELD_H);

    // Invincibility countdown
    if (state.invincibility > 0) {
      state.invincibility--;
    }

    // Sync rotation and invincibility blink to PixiGraphic
    const graphic = gameModel.getTypedUnsafe(PixiGraphic, entity);
    graphic.rotation = (state.angle * 180) / Math.PI;
    if (state.invincibility > 0) {
      graphic.opacity = Math.floor(state.invincibility / 4) % 2 === 0 ? 1 : 0.2;
    } else {
      graphic.opacity = 1;
    }

    // Fire
    state.fireCooldown = Math.max(0, state.fireCooldown - 1);
    if (firing && state.fireCooldown === 0) {
      state.fireCooldown = FIRE_COOLDOWN;
      const bx = transform.x + Math.cos(state.angle) * 12;
      const by = transform.y + Math.sin(state.angle) * 12;
      const bvx = Math.cos(state.angle) * BULLET_SPEED + loco.x * 0.3;
      const bvy = Math.sin(state.angle) * BULLET_SPEED + loco.y * 0.3;
      createBullet(gameModel, entity, bx, by, bvx, bvy);
    }
  };
}

// ── Bullet System ─────────────────────────────────────────────────────────────

@System(AsteroidsBulletState)
export class AsteroidsBulletSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = 1;

  run = (gameModel: GameModel, entity: number) => {
    const state = gameModel.getTypedUnsafe(AsteroidsBulletState, entity);
    state.lifetime--;

    if (state.lifetime <= 0) {
      // Timeout — not a combat death, so direct removal is appropriate.
      // No Damage record needed; HealthSystem is for combat kills.
      gameModel.removeEntity(entity);
      return;
    }

    const t = gameModel.getTypedUnsafe(Transform, entity);
    t.x = wrapField(t.x, FIELD_OFFSET_X, FIELD_OFFSET_X + FIELD_W);
    t.y = wrapField(t.y, FIELD_OFFSET_Y, FIELD_OFFSET_Y + FIELD_H);
  };
}

// ── Asteroid System ───────────────────────────────────────────────────────────

@System(AsteroidsAsteroidState)
export class AsteroidsAsteroidSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = 1;

  run = (gameModel: GameModel, entity: number) => {
    const t = gameModel.getTypedUnsafe(Transform, entity);
    t.x = wrapField(t.x, FIELD_OFFSET_X, FIELD_OFFSET_X + FIELD_W);
    t.y = wrapField(t.y, FIELD_OFFSET_Y, FIELD_OFFSET_Y + FIELD_H);
  };
}

// ── Asteroid Split on Death System ────────────────────────────────────────────
// Triggered by HealthSystem via runMods(entity, ON_DEATH) when an asteroid's
// health reaches 0. Reads the dying asteroid's size and position, spawns two
// smaller child asteroids if size > 1. Because this runs inside the ON_DEATH
// dispatch (before HealthSystem calls removeEntity), the asteroid entity is
// still fully alive and readable.

@System(AsteroidsAsteroidSplitOnDeath)
export class AsteroidsAsteroidSplitOnDeathSystem extends SystemImpl<GameModel> {
  static depth = -1; // negative depth required for runMods dispatch

  run = (gameModel: GameModel, entity: number) => {
    // Only split entities that are actually asteroids
    if (!gameModel.hasComponent(AsteroidsAsteroidState, entity)) return;

    const asteroidState = gameModel.getTypedUnsafe(AsteroidsAsteroidState, entity);
    const size = asteroidState.size;
    if (size <= 1) return; // small asteroids don't split

    const at = gameModel.getTypedUnsafe(Transform, entity);
    for (let s = 0; s < 2; s++) {
      const angle = gameModel.rand.float(0, Math.PI * 2);
      const speed = gameModel.rand.float(1, 2.5);
      createAsteroid(gameModel, at.x, at.y, Math.cos(angle) * speed, Math.sin(angle) * speed, size - 1);
    }
  };
}

// ── Collision Reaction System ─────────────────────────────────────────────────
// Reads physics-engine collision pairs and feeds them into the RPG damage
// pipeline: constructs Damage objects, pushes onto Damageable.damages,
// decrements Health. HealthSystem (TARGET phase) then reaps dead entities,
// fires ON_KILL / ON_DEATH hooks, and attributes kills via getLastDamage().
//
// Bullet ↔ Asteroid: bullet damages asteroid, asteroid's health drops to 0,
//   HealthSystem removes asteroid and credits bullet's Owner via KillStats.
//   Bullet also takes lethal damage (spent on impact).
//   Score is credited here to the bullet's owner immediately (in addition to
//   any ON_KILL processing HealthSystem does).
//   Child asteroids are spawned by AsteroidsAsteroidSplitOnDeathSystem via
//   the ON_DEATH hook — not here.
//
// Ship ↔ Asteroid: asteroid damages ship (if not invincible). If ship
//   survives, it resets to center with invincibility. If ship dies,
//   board transitions to GAME_OVER — and we set health to 1 to prevent
//   HealthSystem from removing the ship entity (we still need it for the
//   UI to read score/lives on the game-over screen).

@System(AsteroidsBoard)
export class AsteroidsCollisionSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = 3;

  run = (gameModel: GameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(AsteroidsBoard, entity);
    if (board.status !== "PLAYING" || board.shipEntity === -1) return;

    const collisions = gameModel.getTypedUnsafe(Collisions, gameModel.coreEntity);
    const collisionMap = collisions.collisionMap;

    const bulletActives = gameModel.getComponentActives("AsteroidsBulletState");
    const asteroidActives = gameModel.getComponentActives("AsteroidsAsteroidState");

    // Track which entities have already been dealt lethal damage this frame
    // so we don't double-process a bullet or asteroid in multiple pairs.
    const processedBullets = new Set<number>();
    const processedAsteroids = new Set<number>();

    // ── Bullet ↔ Asteroid ──────────────────────────────────────────────
    for (const bulletE of bulletActives) {
      if (processedBullets.has(bulletE)) continue;
      const bulletRow = collisionMap[bulletE];
      if (!bulletRow) continue;

      for (const asteroidE of asteroidActives) {
        if (processedAsteroids.has(asteroidE)) continue;
        if (!bulletRow[asteroidE]) continue;

        processedBullets.add(bulletE);
        processedAsteroids.add(asteroidE);

        // Resolve ownership chain: bullet → owner (ship)
        const ownerComp = gameModel.getTypedUnsafe(Owner, bulletE);
        const ownerEntity = ownerComp.owner;
        const bulletStats = gameModel.getTypedUnsafe(DamageStats, bulletE);

        // Apply bullet's damage to the asteroid via the damage pipeline.
        // This pushes a Damage record onto asteroid's Damageable.damages
        // and decrements asteroid's Health. HealthSystem will see health <= 0
        // next TARGET phase, call getLastDamage() to find the bullet/owner,
        // fire ON_KILL on the owner, and remove the asteroid entity.
        applyDamage(gameModel, asteroidE, bulletE, ownerEntity, bulletStats);

        // Credit score immediately to the ship (so the UI reflects it this
        // frame). HealthSystem's KillStats integration provides a second,
        // engine-level accounting path for free.
        const asteroidState = gameModel.getTypedUnsafe(AsteroidsAsteroidState, asteroidE);
        const size = asteroidState.size;
        if (ownerEntity !== null && gameModel.isActive(ownerEntity)) {
          if (gameModel.hasComponent(AsteroidsShipState, ownerEntity)) {
            const ownerShip = gameModel.getTypedUnsafe(AsteroidsShipState, ownerEntity);
            ownerShip.score += ASTEROID_SCORE[size] ?? 0;
          }
        }

        // Bullet is spent — apply lethal self-damage so HealthSystem
        // removes it. We use the asteroid's stats as the "attacker" for
        // the bullet's death record (the asteroid destroyed the bullet).
        const asteroidStats = gameModel.getTypedUnsafe(DamageStats, asteroidE);
        applyDamage(gameModel, bulletE, asteroidE, asteroidE, asteroidStats);

        break; // this bullet is spent, move to next bullet
      }
    }

    // ── Ship ↔ Asteroid ────────────────────────────────────────────────
    if (!gameModel.isActive(board.shipEntity)) return;
    const shipState = gameModel.getTypedUnsafe(AsteroidsShipState, board.shipEntity);
    if (shipState.invincibility > 0) return;

    const shipRow = collisionMap[board.shipEntity];
    if (!shipRow) return;

    const currentAsteroids = gameModel.getComponentActives("AsteroidsAsteroidState");
    for (const asteroidE of currentAsteroids) {
      if (!shipRow[asteroidE]) continue;

      // Apply asteroid's damage to ship via the damage pipeline.
      const asteroidStats = gameModel.getTypedUnsafe(DamageStats, asteroidE);
      applyDamage(gameModel, board.shipEntity, asteroidE, asteroidE, asteroidStats);

      const shipHealth = gameModel.getTypedUnsafe(Health, board.shipEntity);
      if (shipHealth.health <= 0) {
        // Game over. We keep the ship entity alive for the UI to read
        // (score, etc.) by clamping health back to 1 and immediately
        // setting the board status. HealthSystem will see health > 0
        // and leave the entity alone.
        shipHealth.health = 1;
        board.status = "GAME_OVER";
        return;
      }

      // Ship survived — reset to center with invincibility
      resetShip(gameModel, board.shipEntity);
      break; // only process one hit per frame
    }
  };
}

// ── Level Progression System ──────────────────────────────────────────────────

@System(AsteroidsBoard)
export class AsteroidsLevelSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = 4;

  run = (gameModel: GameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(AsteroidsBoard, entity);
    if (board.status !== "PLAYING" || board.shipEntity === -1) return;

    const remainingAsteroids = gameModel.getComponentActives("AsteroidsAsteroidState");
    if (remainingAsteroids.length === 0) {
      board.level++;
      const shipT = gameModel.getTypedUnsafe(Transform, board.shipEntity);
      spawnAsteroidWave(INITIAL_ASTEROIDS + board.level - 1, gameModel, shipT.x, shipT.y);
    }
  };
}

// ── Format context ────────────────────────────────────────────────────────────

function formatContext(board: AsteroidsBoard, gameModel: ReadOnlyGameModel) {
  let score = 0;
  let lives = 0;

  if (board.shipEntity !== -1 && gameModel.isActive(board.shipEntity)) {
    const shipState = gameModel.getTypedUnsafe(AsteroidsShipState, board.shipEntity);
    const shipHealth = gameModel.getTypedUnsafe(Health, board.shipEntity);
    score = shipState.score;
    lives = shipHealth.health;
  }

  let statusMessage = `Score: ${score}  Lives: ${lives}  Level: ${board.level}`;
  if (board.status === "GAME_OVER") statusMessage = "Game Over!";

  return {
    statusMessage,
    showGameOver: board.status !== "PLAYING",
  };
}

// ── Draw / UI System ──────────────────────────────────────────────────────────

@System(AsteroidsBoard)
export class AsteroidsUISystem extends DrawSystemImpl<ReadOnlyGameModel> {
  uiService: UIService;
  uiMap: UiMap;
  uiElements: UIElement[] = [];

  constructor(query: QueryInstance) {
    super(query);
    this.uiService = UIService.getInstance();
  }

  init = (gameModel: ReadOnlyGameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(AsteroidsBoard, entity);
    const uiAsset = AssetLoader.getInstance().getUi(board.uiMap);
    this.uiMap = buildUiMap(uiAsset);

    const initialContext = formatContext(board, gameModel);

    const eventHandler = (_playerIndex: number, eventName: string, _eventType: string, _context: any) => {
      if (eventName === "onRestartClick") {
        const mutableGameModel = gameModel as any as GameModel;
        const mutableBoard = mutableGameModel.getTypedUnsafe(AsteroidsBoard, entity);
        resetGame(mutableBoard, mutableGameModel);
      }
    };

    const built = this.uiMap.build(initialContext, eventHandler);
    this.uiElements = Object.values(built);
    for (const el of this.uiElements) {
      this.uiService.addToUI(el);
    }
  };

  run = (gameModel: ReadOnlyGameModel, entity: number) => {
    if (!this.uiElements.length) return;
    if (this.uiElements.some((ui) => ui.destroyed)) {
      this.init(gameModel, entity);
      return;
    }
    const board = gameModel.getTypedUnsafe(AsteroidsBoard, entity);
    this.uiMap.update(formatContext(board, gameModel));
  };

  cleanup = () => {
    if (this.uiElements.length) {
      this.uiService.removeFromUI(this.uiElements);
      this.uiElements = [];
    }
  };
}