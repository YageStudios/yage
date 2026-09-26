import { EntityFactory } from "yage/entity/EntityFactory";
import type { GameModel } from "yage/game/GameModel";
import { Physics } from "yage/schemas/physics/Physics";
import { RigidBox } from "yage/schemas/physics/RigidBox";
import { RigidCircle } from "yage/schemas/physics/RigidCircle";
import { Locomotion } from "yage/schemas/entity/Locomotion";
import { CollisionCategoryEnum } from "yage/constants/enums";
import { PixiGraphic } from "yage/schemas/render/PixiGraphic";
import { Transform } from "yage/schemas/entity/Transform";
import { cos, sin } from "yage/utils/deterministicMath";
import { BrickUpBall, BrickUpBoard, BrickUpBrick, BrickUpPaddle, BrickUpPickup } from "./BrickUpComponents";

export type PhysicsMode = "manual" | "rapier";


// ── Field geometry ────────────────────────────────────────────────────────────
// A square arena centered on the 1920x1080 viewport. Each of the four sides
// is a goal with an opening in the middle; a player-owned paddle guards the
// opening, unowned gaps behave like solid wall.

export const CENTER_X = 960;
export const CENTER_Y = 540;
export const FIELD_HALF = 380;
export const GOAL_GAP = 320;

// Side 0 = bottom, 1 = top, 2 = left, 3 = right.
export const MAX_SIDES = 4;

export const PADDLE_W = 120;
export const PADDLE_T = 16;
export const PADDLE_OFF = 26; // paddle center distance inside the side line
export const PADDLE_SPEED = 6;

export const BALL_R = 9;
export const BALL_SPEED = 5.2;
export const MAX_DEFLECT = Math.PI / 3;
// After a paddle bounce the direction keeps at least this component on both
// field axes, so shallow trajectories can never strand the ball in the open
// band outside the brick field.
export const MIN_AXIS_COMPONENT = 0.55;
export const MAX_BALLS = 6;
export const RESPAWN_FRAMES = 90;

export const START_LIVES = 3;

export const WIDE_MULT = 1.6;
export const WIDE_FRAMES = 600;
export const SLOW_MULT = 0.6;
export const SLOW_FRAMES = 600;
export const PIERCE_FRAMES = 360;
export const REVERSE_FRAMES = 420;

export const BRICK_COLS = 10;
export const BRICK_ROWS = 4;
// Square bricks read better on a four-sided field.
export const BRICK_W = 70;
export const BRICK_H = 70;
export const BRICK_GAP = 6;
// The brick field spans the arena to within a few pixels (so crossings
// always intersect it) and is centered on the arena center.
export const BRICK_TOP = -(BRICK_ROWS * (BRICK_H + BRICK_GAP) - BRICK_GAP) / 2;
export const REINFORCED_CHANCE = 0.3;
export const DROP_CHANCE = 0.25;
export const PICKUP_SIZE = 18;
export const PICKUP_SPEED_START = 1.1;
export const PICKUP_SPEED_MAX = 2.6;
export const PICKUP_STEER = 0.03;

export const UPGRADE_TYPES = ["WIDE", "MULTI", "SLOW", "PASS", "REVERSE"] as const;
export type UpgradeType = (typeof UPGRADE_TYPES)[number];

export const UPGRADE_COLORS: Record<UpgradeType, string> = {
  WIDE: "#ff00ff",
  MULTI: "#00ffff",
  SLOW: "#00ff00",
  PASS: "#ffaa00",
  REVERSE: "#ff3333",
};

export const PLAYER_COLORS = ["#66ccff", "#ffcc66", "#88ff88", "#ff88aa"];

export const BRICK_COLORS = ["#ff4444", "#ff8844", "#ffcc44", "#44ff44", "#4488ff"];

// Clockwise successor order used to pick the REVERSE victim.
const CLOCKWISE = [0, 2, 1, 3];

// Arena frame: two slim wall segments per side flanking the (large) goal
// gap. The gaps themselves stay open — that is where goals happen.
export const WALL_T = 12;
export const WALL_SEGMENT = FIELD_HALF - GOAL_GAP / 2;

export const isHorizontalSide = (side: number): boolean => side === 0 || side === 1;

// Outward normal of a side, field-local.
export const sideNormal = (side: number): { x: number; y: number } => {
  switch (side) {
    case 0:
      return { x: 0, y: 1 };
    case 1:
      return { x: 0, y: -1 };
    case 2:
      return { x: -1, y: 0 };
    default:
      return { x: 1, y: 0 };
  }
};

// Field-local coordinate running along the side (the paddle's movement axis).
export const alongSide = (side: number, lx: number, ly: number): number =>
  isHorizontalSide(side) ? lx : ly;

// Signed field-local distance from the center along the side's outward normal.
export const acrossSide = (side: number, lx: number, ly: number): number => {
  const n = sideNormal(side);
  return lx * n.x + ly * n.y;
};

export const paddleHome = (side: number): { x: number; y: number } => {
  const inward = FIELD_HALF - PADDLE_OFF;
  switch (side) {
    case 0:
      return { x: CENTER_X, y: CENTER_Y + inward };
    case 1:
      return { x: CENTER_X, y: CENTER_Y - inward };
    case 2:
      return { x: CENTER_X - inward, y: CENTER_Y };
    default:
      return { x: CENTER_X + inward, y: CENTER_Y };
  }
};

// ── Shared lookups ────────────────────────────────────────────────────────────

export const getBoardEntity = (gameModel: GameModel): number => {
  const boardEntity = gameModel.getComponentActives("BrickUpBoard")[0];
  if (boardEntity === undefined) {
    throw new Error("BrickUpBoard entity missing");
  }
  return boardEntity;
};

export const getBoard = (gameModel: GameModel): BrickUpBoard =>
  gameModel.getTypedUnsafe(BrickUpBoard, getBoardEntity(gameModel));

// ── Spawning ──────────────────────────────────────────────────────────────────

export const spawnBrickPattern = (gameModel: GameModel, board: BrickUpBoard): void => {
  const entities: number[] = [];
  const fieldW = BRICK_COLS * (BRICK_W + BRICK_GAP) - BRICK_GAP;
  const startX = CENTER_X - fieldW / 2 + BRICK_W / 2;
  for (let row = 0; row < BRICK_ROWS; row++) {
    for (let col = 0; col < BRICK_COLS; col++) {
      const hp = gameModel.rand.number() < REINFORCED_CHANCE ? 2 : 1;
      const brick = EntityFactory.getInstance().generateEntity(gameModel, "BrickUpBrick");
      const transform = gameModel.getTypedUnsafe(Transform, brick);
      transform.x = startX + col * (BRICK_W + BRICK_GAP);
      transform.y = CENTER_Y + BRICK_TOP + row * (BRICK_H + BRICK_GAP) + BRICK_H / 2;
      const brickData = gameModel.getTypedUnsafe(BrickUpBrick, brick);
      brickData.hp = hp;
      brickData.col = col;
      brickData.row = row;
      if (board.physicsMode === "rapier") {
        gameModel.addComponent(RigidBox, brick, {
          width: BRICK_W,
          height: BRICK_H,
          isStatic: true,
          restitution: 1,
          // Friction 0 keeps the ball spin-free, so component-only playback
          // (rebuild without the solver blob) reproduces trajectories.
          friction: 0,
          collisionEvents: true,
          collisionCategory: CollisionCategoryEnum.ENEMY,
          collisionMask: [CollisionCategoryEnum.ALL],
        });
      }
      const graphic = gameModel.getTypedUnsafe(PixiGraphic, brick);
      graphic.fillColor = BRICK_COLORS[row % BRICK_COLORS.length];
      if (hp > 1) {
        // Armored bricks keep their row color and gain a bright casing.
        graphic.strokeColor = "#f4f7ff";
        graphic.lineWidth = 3;
      }
      entities.push(brick);
    }
  }
  board.brickEntities = entities;
};

export const spawnBallAt = (
  gameModel: GameModel,
  board: BrickUpBoard,
  x: number,
  y: number,
  vx: number,
  vy: number,
  lastTouchSide: number
): number => {
  const ball = EntityFactory.getInstance().generateEntity(gameModel, "BrickUpBall");
  const transform = gameModel.getTypedUnsafe(Transform, ball);
  transform.x = x;
  transform.y = y;
  const ballData = gameModel.getTypedUnsafe(BrickUpBall, ball);
  ballData.vx = vx;
  ballData.vy = vy;
  ballData.lastTouchSide = lastTouchSide;
  if (board.physicsMode === "rapier") {
    // Locomotion is the velocity source of truth the RigidCircle system
    // feeds into the solver; velocityLock mirrors solver results back so
    // component state alone can rebuild the ball (no-bundle playback).
    gameModel.addComponent(Locomotion, ball, { x: vx, y: vy });
    gameModel.addComponent(RigidCircle, ball, {
      radius: BALL_R,
      mass: 1,
      restitution: 1,
      friction: 0,
      velocityLock: true,
      collisionEvents: true,
      collisionCategory: CollisionCategoryEnum.PROJECTILE,
      collisionMask: [CollisionCategoryEnum.ALL],
    });
  }
  board.ballEntities.push(ball);
  return ball;
};

// ── Arena visuals (both physics modes) ────────────────────────────────────────

// One-time arena dressing, spawned on the first stepped frame when the
// physics mode is already known: a center-circle court marking (the engine
// y-sorts everything, so it sits below all gameplay), and a visible border
// with a gap on every side — the gaps are the goals. In rapier mode the
// border segments are also the physical walls.
export const spawnArenaFrame = (gameModel: GameModel): void => {
  const board = getBoard(gameModel);

  const center = EntityFactory.getInstance().generateEntity(gameModel, "BrickUpCenter");
  const centerTransform = gameModel.getTypedUnsafe(Transform, center);
  centerTransform.x = CENTER_X;
  centerTransform.y = CENTER_Y;

  for (let side = 0; side < MAX_SIDES; side++) {
    const n = sideNormal(side);
    const across = FIELD_HALF + WALL_T / 2;
    for (const dir of [-1, 1]) {
      const along = dir * (GOAL_GAP / 2 + WALL_SEGMENT / 2);
      const x = isHorizontalSide(side) ? CENTER_X + along : CENTER_X + n.x * across;
      const y = isHorizontalSide(side) ? CENTER_Y + n.y * across : CENTER_Y + along;
      spawnWall(gameModel, board, x, y, isHorizontalSide(side));
    }
  }
};

const spawnWall = (gameModel: GameModel, board: BrickUpBoard, x: number, y: number, horizontal: boolean): void => {
  const wall = EntityFactory.getInstance().generateEntity(gameModel, "BrickUpWall");
  const transform = gameModel.getTypedUnsafe(Transform, wall);
  transform.x = x;
  transform.y = y;
  if (!horizontal) {
    const graphic = gameModel.getTypedUnsafe(PixiGraphic, wall);
    graphic.rectangle = { x: 0, y: 0, width: PADDLE_T, height: WALL_SEGMENT } as any;
  }
  if (board.physicsMode === "rapier") {
    gameModel.addComponent(RigidBox, wall, {
      width: horizontal ? WALL_SEGMENT : WALL_T,
      height: horizontal ? WALL_T : WALL_SEGMENT,
      isStatic: true,
      restitution: 1,
      friction: 0,
    });
  }
};

// Switches a freshly created world to Rapier physics. Must run before the
// first step (the arena frame and brick field are spawned on the first
// stepped frame, when the mode is known) and before any player joins
// (paddles get a collider at join time).
export const enableRapierArena = (gameModel: GameModel): void => {
  const board = getBoard(gameModel);
  board.physicsMode = "rapier";
  gameModel.addComponent(Physics, gameModel.coreEntity, { gravityX: 0, gravityY: 0 });
};

// Serves a ball from the center in a seeded random direction, nudged away
// from a purely horizontal launch so rallies always reach the paddles.
export const spawnCenterBall = (gameModel: GameModel, board: BrickUpBoard): number => {
  const angle = gameModel.rand.float(0, Math.PI * 2);
  let dx = cos(angle);
  let dy = sin(angle);
  if (Math.abs(dy) < 0.2) {
    dy = dy >= 0 ? 0.2 : -0.2;
    const len = Math.sqrt(dx * dx + dy * dy);
    dx /= len;
    dy /= len;
  }
  return spawnBallAt(gameModel, board, CENTER_X, CENTER_Y, dx * BALL_SPEED, dy * BALL_SPEED, -1);
};

export const spawnPickup = (
  gameModel: GameModel,
  board: BrickUpBoard,
  x: number,
  y: number
): void => {
  const pickupType = UPGRADE_TYPES[gameModel.rand.int(0, UPGRADE_TYPES.length - 1)];
  const angle = gameModel.rand.float(0, Math.PI * 2);
  const pickup = EntityFactory.getInstance().generateEntity(gameModel, "BrickUpPickup");
  const transform = gameModel.getTypedUnsafe(Transform, pickup);
  transform.x = x;
  transform.y = y;
  const pickupData = gameModel.getTypedUnsafe(BrickUpPickup, pickup);
  pickupData.pickupType = pickupType;
  pickupData.vx = cos(angle) * PICKUP_SPEED_START;
  pickupData.vy = sin(angle) * PICKUP_SPEED_START;
  const graphic = gameModel.getTypedUnsafe(PixiGraphic, pickup);
  graphic.fillColor = UPGRADE_COLORS[pickupType];
  board.pickupEntities.push(pickup);
};

// ── Upgrades ──────────────────────────────────────────────────────────────────

export const paddleWidthMult = (paddle: { wideTimer: number }): number =>
  paddle.wideTimer > 0 ? WIDE_MULT : 1;

// REVERSE hits the next occupied side clockwise; with no other player the
// pickup does nothing.
export const nextClockwisePaddle = (
  gameModel: GameModel,
  fromSide: number
): { entity: number; data: BrickUpPaddle } | null => {
  const start = CLOCKWISE.indexOf(fromSide);
  for (let step = 1; step < CLOCKWISE.length; step++) {
    const side = CLOCKWISE[(start + step) % CLOCKWISE.length];
    const entity = gameModel.getComponentActives("BrickUpPaddle").find((p) => {
      return gameModel.getTypedUnsafe(BrickUpPaddle, p).side === side;
    });
    if (entity !== undefined) {
      return { entity, data: gameModel.getTypedUnsafe(BrickUpPaddle, entity) };
    }
  }
  return null;
};

export const applyUpgrade = (gameModel: GameModel, board: BrickUpBoard, paddle: BrickUpPaddle, pickupType: string): void => {
  board.upgradesApplied += 1;
  switch (pickupType) {
    case "WIDE":
      paddle.wideTimer = WIDE_FRAMES;
      break;
    case "SLOW":
      board.slowTimer = SLOW_FRAMES;
      break;
    case "PASS":
      // Rapier owns bounce resolution, so pierce has no physical lever in
      // that mode; the upgrade only bites in the manual physics mode.
      if (board.physicsMode !== "rapier") {
        board.pierceTimer = PIERCE_FRAMES;
      }
      break;
    case "MULTI": {
      const current = [...board.ballEntities];
      for (const ballEntity of current) {
        if (board.ballEntities.length >= MAX_BALLS) {
          break;
        }
        const ballData = gameModel.getTypedUnsafe(BrickUpBall, ballEntity);
        const transform = gameModel.getTypedUnsafe(Transform, ballEntity);
        for (const angle of [0.5, -0.5]) {
          if (board.ballEntities.length >= MAX_BALLS) {
            break;
          }
          const vx = ballData.vx * cos(angle) - ballData.vy * sin(angle);
          const vy = ballData.vx * sin(angle) + ballData.vy * cos(angle);
          spawnBallAt(gameModel, board, transform.x, transform.y, vx, vy, ballData.lastTouchSide);
        }
      }
      break;
    }
    case "REVERSE": {
      const target = nextClockwisePaddle(gameModel, paddle.side);
      if (target) {
        target.data.reversedTimer = REVERSE_FRAMES;
      }
      break;
    }
    default:
      break;
  }
};
