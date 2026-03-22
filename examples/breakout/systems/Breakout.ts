import { Component, defaultValue, DrawSystemImpl, QueryInstance, Schema, System, SystemImpl, type } from "minecs";
import type { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import { UIService } from "yage/ui/UIService";
import AssetLoader from "yage/loader/AssetLoader";
import type { UiMap } from "yage/ui/UiMap";
import { buildUiMap } from "yage/ui/UiMap";
import type { UIElement } from "yage/ui/UIElement";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { keyDown, keyPressed } from "yage/utils/keys";
import { EntityFactory } from "yage/entity/EntityFactory";
import { Transform } from "yage/schemas/entity/Transform";
import { Locomotion } from "yage/schemas/entity/Locomotion";
import { PixiGraphic } from "yage/schemas/render/PixiGraphic";
import { Collisions } from "yage/schemas/physics/Collisions";
import { RigidBox } from "yage/schemas/physics/RigidBox";
import { RigidCircle } from "yage/schemas/physics/RigidCircle";

// ── Constants ─────────────────────────────────────────────────────────────────

const FIELD_W = 640;
const FIELD_H = 480;
const FIELD_OFFSET_X = (1920 - FIELD_W) / 2; // 640 — center in 1920-wide viewport
const FIELD_OFFSET_Y = (1080 - FIELD_H) / 2; // 300 — center in 1080-tall viewport

const PADDLE_W = 80;
const PADDLE_H = 12;
const PADDLE_Y = FIELD_OFFSET_Y + FIELD_H - 30; // world Y of paddle center
const PADDLE_SPEED = 7;

const BALL_RADIUS = 8;
const BALL_VX = 3; // pixels/frame
const BALL_VY = -4; // pixels/frame (upward)

const BRICK_COLS = 10;
const BRICK_ROWS = 6;
const BRICK_W = 56;
const BRICK_H = 18;
const BRICK_GAP = 4;
const BRICK_OFFSET_X = FIELD_OFFSET_X + (FIELD_W - (BRICK_W + BRICK_GAP) * BRICK_COLS + BRICK_GAP) / 2;
const BRICK_OFFSET_Y = FIELD_OFFSET_Y + 50;

const WALL_T = 40; // wall thickness in pixels

const BRICK_COLORS = ["#ff4444", "#ff8844", "#ffcc44", "#44ff44", "#4488ff", "#cc44ff"];

const POWERUP_DROP_CHANCE = 0.15;
const POWERUP_DROP_SPEED = 2;
const POWERUP_SIZE = 16;
const POWERUP_DURATION = 600;

const POWERUP_COLORS: Record<string, string> = {
  MULTIBALL: "#00ffff",
  BIGGER_PADDLE: "#ff00ff",
  SLOW_BALL: "#00ff00",
  BIG_BALL: "#ffff00",
  PIERCE_BALL: "#ff0000",
};

// ── Component ─────────────────────────────────────────────────────────────────

@Component()
export class BreakoutBoard extends Schema {
  @type("string")
  @defaultValue("PLAYING")
  status: string;

  @type("number")
  @defaultValue(0)
  score: number;

  @type("number")
  @defaultValue(3)
  lives: number;

  @type("boolean")
  @defaultValue(true)
  ballAttached: boolean;

  @type("number")
  @defaultValue(-1)
  paddleEntity: number;

  @type("number")
  @defaultValue(-1)
  ballEntity: number;

  @type(["number"])
  @defaultValue([])
  brickEntities: number[];

  @type(["number"])
  @defaultValue([])
  ballEntities: number[];

  @type(["number"])
  @defaultValue([])
  powerupEntities: number[];

  @type("string")
  @defaultValue("BreakoutUI")
  uiMap: string;
}

@Component()
export class PowerupType extends Schema {
  @type("string")
  @defaultValue("")
  powerupType: string;
}

@Component()
export class BreakoutPowerups extends Schema {
  @type("number")
  @defaultValue(1)
  paddleWidthMult: number;

  @type("number")
  @defaultValue(1)
  ballSizeMult: number;

  @type("number")
  @defaultValue(1)
  ballSpeedMult: number;

  @type("boolean")
  @defaultValue(false)
  pierceEnabled: number;

  @type("number")
  @defaultValue(0)
  multiballCount: number;

  @type("number")
  @defaultValue(0)
  slowBallTimer: number;

  @type("number")
  @defaultValue(0)
  bigBallTimer: number;

  @type("number")
  @defaultValue(0)
  pierceBallTimer: number;

  @type("number")
  @defaultValue(0)
  biggerPaddleTimer: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function createWall(gameModel: GameModel, x: number, y: number, w: number, h: number): void {
  const wall = EntityFactory.getInstance().generateEntity(gameModel, "BreakoutWall", {
    RigidBox: {
      width: w,
      height: h,
    },
  });
  const t = gameModel.getTypedUnsafe(Transform, wall);
  t.x = x;
  t.y = y;
  // const rb = gameModel.getTypedUnsafe(RigidBox, wall);
  // rb.width = w;
  // rb.height = h;
  // Ensure the wall has a visible PixiGraphic matching its physics box
  try {
    const graphic = gameModel.getTypedUnsafe(PixiGraphic, wall);
    graphic.fillColor = graphic.fillColor ?? "#888888";
    graphic.rectangle = {
      x: 0,
      y: 0,
      width: w,
      height: h,
    } as any;
  } catch (e) {
    // If PixiGraphic is not present, ignore — prefab should include it.
  }
}

function spawnBricks(gameModel: GameModel, board: BreakoutBoard): void {
  const brickEntities: number[] = [];
  for (let row = 0; row < BRICK_ROWS; row++) {
    for (let col = 0; col < BRICK_COLS; col++) {
      const brickEntity = EntityFactory.getInstance().generateEntity(gameModel, "BreakoutBrick");
      const t = gameModel.getTypedUnsafe(Transform, brickEntity);
      t.x = BRICK_OFFSET_X + col * (BRICK_W + BRICK_GAP) + BRICK_W / 2;
      t.y = BRICK_OFFSET_Y + row * (BRICK_H + BRICK_GAP) + BRICK_H / 2;
      const graphic = gameModel.getTypedUnsafe(PixiGraphic, brickEntity);
      graphic.fillColor = BRICK_COLORS[row % BRICK_COLORS.length];
      brickEntities.push(brickEntity);
    }
  }
  board.brickEntities = brickEntities;
}

function resetBall(gameModel: GameModel, board: BreakoutBoard): void {
  if (board.paddleEntity === -1) return;

  // Remove extra balls
  for (const ballE of board.ballEntities) {
    if (gameModel.isActive(ballE)) {
      gameModel.removeEntity(ballE);
    }
  }

  // Create new ball if needed
  if (board.ballEntity === -1) {
    board.ballEntity = EntityFactory.getInstance().generateEntity(gameModel, "BreakoutBall");
  }

  board.ballEntities = [board.ballEntity];

  const paddleTransform = gameModel.getTypedUnsafe(Transform, board.paddleEntity);
  const ballTransform = gameModel.getTypedUnsafe(Transform, board.ballEntity);
  ballTransform.x = paddleTransform.x;
  ballTransform.y = PADDLE_Y - PADDLE_H / 2 - BALL_RADIUS - 2;
  const ballLoco = gameModel.getTypedUnsafe(Locomotion, board.ballEntity);
  ballLoco.x = 0;
  ballLoco.y = 0;
  board.ballAttached = true;
}

function createBall(gameModel: GameModel, board: BreakoutBoard, x: number, y: number, vx: number, vy: number): number {
  const ballEntity = EntityFactory.getInstance().generateEntity(gameModel, "BreakoutBall");
  const ballTransform = gameModel.getTypedUnsafe(Transform, ballEntity);
  ballTransform.x = x;
  ballTransform.y = y;
  const ballLoco = gameModel.getTypedUnsafe(Locomotion, ballEntity);
  ballLoco.x = vx;
  ballLoco.y = vy;
  board.ballEntities.push(ballEntity);
  return ballEntity;
}

function spawnMultiball(gameModel: GameModel, board: BreakoutBoard, powerups: BreakoutPowerups): void {
  const mainBallEntity = board.ballEntity;
  if (mainBallEntity === -1) return;

  const ballTransform = gameModel.getTypedUnsafe(Transform, mainBallEntity);
  const ballLoco = gameModel.getTypedUnsafe(Locomotion, mainBallEntity);

  const baseSpeed = Math.sqrt(ballLoco.x * ballLoco.x + ballLoco.y * ballLoco.y);
  const angle = Math.atan2(ballLoco.y, ballLoco.x);

  const numBalls = 2 + powerups.multiballCount;
  const spreadAngle = Math.PI / 4;

  for (let i = 0; i < numBalls; i++) {
    const offsetAngle = -spreadAngle / 2 + (spreadAngle / (numBalls - 1 || 1)) * i;
    const newAngle = angle + offsetAngle;
    const newVx = Math.cos(newAngle) * baseSpeed;
    const newVy = Math.sin(newAngle) * baseSpeed;

    if (i === 0) {
      ballLoco.x = newVx;
      ballLoco.y = newVy;
    } else {
      createBall(gameModel, board, ballTransform.x, ballTransform.y, newVx, newVy);
    }
  }
}

function applyPowerup(
  gameModel: GameModel,
  board: BreakoutBoard,
  powerups: BreakoutPowerups,
  powerupType: string,
): void {
  switch (powerupType) {
    case "MULTIBALL":
      powerups.multiballCount++;
      spawnMultiball(gameModel, board, powerups);
      break;
    case "BIGGER_PADDLE":
      powerups.paddleWidthMult = 1.5;
      powerups.biggerPaddleTimer = POWERUP_DURATION;
      break;
    case "SLOW_BALL":
      powerups.ballSpeedMult = 0.5;
      powerups.slowBallTimer = POWERUP_DURATION;
      break;
    case "BIG_BALL":
      powerups.ballSizeMult = 1.5;
      powerups.bigBallTimer = POWERUP_DURATION;
      break;
    case "PIERCE_BALL":
      powerups.pierceEnabled = 1;
      powerups.pierceBallTimer = POWERUP_DURATION;
      break;
  }
}

function updatePowerupTimers(gameModel: GameModel, powerups: BreakoutPowerups): void {
  if (powerups.slowBallTimer > 0) {
    powerups.slowBallTimer--;
    if (powerups.slowBallTimer === 0) {
      powerups.ballSpeedMult = 1;
    }
  }

  if (powerups.bigBallTimer > 0) {
    powerups.bigBallTimer--;
    if (powerups.bigBallTimer === 0) {
      powerups.ballSizeMult = 1;
    }
  }

  if (powerups.pierceBallTimer > 0) {
    powerups.pierceBallTimer--;
    if (powerups.pierceBallTimer === 0) {
      powerups.pierceEnabled = 0;
    }
  }

  if (powerups.biggerPaddleTimer > 0) {
    powerups.biggerPaddleTimer--;
    if (powerups.biggerPaddleTimer === 0) {
      powerups.paddleWidthMult = 1;
    }
  }
}

function spawnPowerup(gameModel: GameModel, board: BreakoutBoard, brickX: number, brickY: number): void {
  if (Math.random() > POWERUP_DROP_CHANCE) return;

  const powerupTypes = ["MULTIBALL", "BIGGER_PADDLE", "SLOW_BALL", "BIG_BALL", "PIERCE_BALL"];
  const powerupType = powerupTypes[Math.floor(Math.random() * powerupTypes.length)];

  const powerupEntity = EntityFactory.getInstance().generateEntity(gameModel, "BreakoutPowerup");
  const transform = gameModel.getTypedUnsafe(Transform, powerupEntity);
  transform.x = brickX;
  transform.y = brickY;

  const graphic = gameModel.getTypedUnsafe(PixiGraphic, powerupEntity);
  graphic.fillColor = POWERUP_COLORS[powerupType];
  const powerupTypeComponent = gameModel.getTypedUnsafe(PowerupType, powerupEntity);
  powerupTypeComponent.powerupType = powerupType;

  board.powerupEntities.push(powerupEntity);
}

function restartGame(gameModel: GameModel, board: BreakoutBoard, powerups: BreakoutPowerups): void {
  for (const brickEntity of board.brickEntities) {
    gameModel.removeEntity(brickEntity);
  }
  board.brickEntities = [];

  for (const powerupEntity of board.powerupEntities) {
    gameModel.removeEntity(powerupEntity);
  }
  board.powerupEntities = [];

  // Remove extra balls
  for (const ballE of board.ballEntities) {
    if (ballE !== board.ballEntity && gameModel.isActive(ballE)) {
      gameModel.removeEntity(ballE);
    }
  }
  board.ballEntities = [board.ballEntity];

  // Reset powerups
  powerups.paddleWidthMult = 1;
  powerups.ballSizeMult = 1;
  powerups.ballSpeedMult = 1;
  powerups.pierceEnabled = 0;
  powerups.multiballCount = 0;
  powerups.slowBallTimer = 0;
  powerups.bigBallTimer = 0;
  powerups.pierceBallTimer = 0;
  powerups.biggerPaddleTimer = 0;

  if (board.paddleEntity !== -1) {
    const paddleTransform = gameModel.getTypedUnsafe(Transform, board.paddleEntity);
    paddleTransform.x = FIELD_OFFSET_X + FIELD_W / 2;
    const paddleRb = gameModel.getTypedUnsafe(RigidBox, board.paddleEntity);
    paddleRb.width = PADDLE_W;
  }

  spawnBricks(gameModel, board);
  resetBall(gameModel, board);
  board.score = 0;
  board.lives = 3;
  board.status = "PLAYING";
}

// ── Init System ───────────────────────────────────────────────────────────────

@System(BreakoutBoard)
export class BreakoutInitSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = -100;

  init = (gameModel: GameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(BreakoutBoard, entity);

    // Add powerups component to board entity
    gameModel.addComponent(BreakoutPowerups, entity);
    const powerups = gameModel.getTypedUnsafe(BreakoutPowerups, entity);

    // Create paddle
    const paddleEntity = EntityFactory.getInstance().generateEntity(gameModel, "BreakoutPaddle");
    const paddleTransform = gameModel.getTypedUnsafe(Transform, paddleEntity);
    paddleTransform.x = FIELD_OFFSET_X + FIELD_W / 2;
    paddleTransform.y = PADDLE_Y;
    board.paddleEntity = paddleEntity;

    // Create ball (attached to paddle)
    const ballEntity = EntityFactory.getInstance().generateEntity(gameModel, "BreakoutBall");
    const ballTransform = gameModel.getTypedUnsafe(Transform, ballEntity);
    ballTransform.x = FIELD_OFFSET_X + FIELD_W / 2;
    ballTransform.y = PADDLE_Y - PADDLE_H / 2 - BALL_RADIUS - 2;
    board.ballEntity = ballEntity;
    board.ballEntities = [ballEntity];
    board.ballAttached = true;

    // Create bricks
    spawnBricks(gameModel, board);

    // Create invisible walls: top, left, right
    createWall(gameModel, FIELD_OFFSET_X + FIELD_W / 2, FIELD_OFFSET_Y - WALL_T / 2, FIELD_W + WALL_T * 2, WALL_T);
    createWall(gameModel, FIELD_OFFSET_X - WALL_T / 2, FIELD_OFFSET_Y + FIELD_H / 2, WALL_T, FIELD_H + WALL_T * 2);
    createWall(
      gameModel,
      FIELD_OFFSET_X + FIELD_W + WALL_T / 2,
      FIELD_OFFSET_Y + FIELD_H / 2,
      WALL_T,
      FIELD_H + WALL_T * 2,
    );

    board.score = 0;
    board.lives = 3;
    board.status = "PLAYING";
  };
}

// ── Game Logic System ─────────────────────────────────────────────────────────

@System(BreakoutBoard)
export class BreakoutSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = 0;

  run = (gameModel: GameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(BreakoutBoard, entity);
    const powerups = gameModel.getTypedUnsafe(BreakoutPowerups, entity);
    if (board.status !== "PLAYING") return;

    const paddleEntity = board.paddleEntity;
    if (paddleEntity === -1) return;

    const paddleTransform = gameModel.getTypedUnsafe(Transform, paddleEntity);
    const paddleRb = gameModel.getTypedUnsafe(RigidBox, paddleEntity);
    const paddleGraphic = gameModel.getTypedUnsafe(PixiGraphic, paddleEntity);
    const currentPaddleWidth = PADDLE_W * powerups.paddleWidthMult;
    paddleRb.width = currentPaddleWidth;
    paddleGraphic.rectangle = {
      x: 0,
      y: 0,
      width: currentPaddleWidth,
      height: PADDLE_H,
    } as any;

    // Update powerup timers
    updatePowerupTimers(gameModel, powerups);

    // Read player input
    const playerEntities = gameModel.getComponentActives("PlayerInput");
    if (playerEntities.length > 0) {
      const pi = gameModel.getTypedUnsafe(PlayerInput, playerEntities[0]);
      if (pi.keyMap) {
        if (keyDown(["left", "a"], pi.keyMap)) {
          paddleTransform.x -= PADDLE_SPEED;
        }
        if (keyDown(["right", "d"], pi.keyMap)) {
          paddleTransform.x += PADDLE_SPEED;
        }
        if (board.ballAttached && keyPressed(["space"], pi.keyMap, pi.prevKeyMap ?? new Map())) {
          board.ballAttached = false;
          const ballLoco = gameModel.getTypedUnsafe(Locomotion, board.ballEntity);
          ballLoco.x = BALL_VX;
          ballLoco.y = BALL_VY;
        }
      }
    }

    paddleTransform.x = clamp(
      paddleTransform.x,
      FIELD_OFFSET_X + currentPaddleWidth / 2,
      FIELD_OFFSET_X + FIELD_W - currentPaddleWidth / 2,
    );

    // Process each ball
    const activeBalls: number[] = board.ballEntity !== -1 ? [board.ballEntity] : [];
    for (const ballE of board.ballEntities) {
      if (ballE !== board.ballEntity && gameModel.isActive(ballE)) {
        activeBalls.push(ballE);
      }
    }

    let hasActiveBall = false;
    const ballsToRemove: number[] = [];

    for (const ballEntity of activeBalls) {
      if (!gameModel.isActive(ballEntity)) continue;

      // Ball follows paddle when attached
      if (board.ballAttached && ballEntity === board.ballEntity) {
        const ballTransform = gameModel.getTypedUnsafe(Transform, ballEntity);
        ballTransform.x = paddleTransform.x;
        ballTransform.y = PADDLE_Y - PADDLE_H / 2 - BALL_RADIUS - 2;
        hasActiveBall = true;
        continue;
      }

      const ballTransform = gameModel.getTypedUnsafe(Transform, ballEntity);
      const ballLoco = gameModel.getTypedUnsafe(Locomotion, ballEntity);

      // Apply speed multiplier
      const baseSpeed = 5;
      const currentSpeed = baseSpeed * powerups.ballSpeedMult;
      const ballMag = Math.sqrt(ballLoco.x * ballLoco.x + ballLoco.y * ballLoco.y);
      if (ballMag > 0) {
        ballLoco.x = (ballLoco.x / ballMag) * currentSpeed;
        ballLoco.y = (ballLoco.y / ballMag) * currentSpeed;
      }

      // Ensure ball always has vertical movement
      if (Math.abs(ballLoco.y) < 1) {
        ballLoco.y = ballLoco.y >= 0 ? 1 : -1;
      }

      // Ball out of bounds check
      if (ballTransform.y > FIELD_OFFSET_Y + FIELD_H + 50) {
        ballsToRemove.push(ballEntity);
        continue;
      }

      hasActiveBall = true;

      // Check paddle collision
      const paddleHalfWidth = currentPaddleWidth / 2;
      const paddleHalfHeight = PADDLE_H / 2;
      if (
        ballTransform.y + BALL_RADIUS >= paddleTransform.y - paddleHalfHeight &&
        ballTransform.y - BALL_RADIUS <= paddleTransform.y + paddleHalfHeight &&
        ballTransform.x >= paddleTransform.x - paddleHalfWidth &&
        ballTransform.x <= paddleTransform.x + paddleHalfWidth &&
        ballLoco.y > 0
      ) {
        const hitPos = (ballTransform.x - paddleTransform.x) / paddleHalfWidth;
        const maxAngle = Math.PI / 3;
        const angle = hitPos * maxAngle;
        const speed = Math.sqrt(ballLoco.x * ballLoco.x + ballLoco.y * ballLoco.y);
        ballLoco.x = Math.sin(angle) * speed;
        ballLoco.y = -Math.cos(angle) * speed;
        ballTransform.y = paddleTransform.y - paddleHalfHeight - BALL_RADIUS - 1;
      }

      // Check physics collisions
      const collisions = gameModel.getTypedUnsafe(Collisions, gameModel.coreEntity);
      const collisionMap = collisions.collisionMap;
      const ballCollisions = collisionMap[ballEntity];

      if (ballCollisions && board.brickEntities.length > 0) {
        const toRemove: number[] = [];
        for (let i = 0; i < board.brickEntities.length; i++) {
          const brickEntity = board.brickEntities[i];
          if (ballCollisions[brickEntity]) {
            toRemove.push(brickEntity);
            const brickTransform = gameModel.getTypedUnsafe(Transform, brickEntity);
            spawnPowerup(gameModel, board, brickTransform.x, brickTransform.y);
            const row = Math.floor(i / BRICK_COLS);
            board.score += (BRICK_ROWS - row) * 10;
          }
        }
        if (toRemove.length > 0) {
          for (const brickEntity of toRemove) {
            gameModel.removeEntity(brickEntity);
          }
          board.brickEntities = board.brickEntities.filter((e) => !toRemove.includes(e));
        }
      }
    }

    // Remove balls that went out of bounds
    for (const ballEntity of ballsToRemove) {
      if (ballEntity === board.ballEntity) {
        board.ballEntity = -1;
      } else {
        gameModel.removeEntity(ballEntity);
      }
    }

    // Check if we lost all balls
    if (!hasActiveBall) {
      board.lives--;
      if (board.lives <= 0) {
        board.status = "GAME_OVER";
      } else {
        resetBall(gameModel, board);
      }
    }

    // Check win
    if (board.brickEntities.length === 0) {
      board.status = "WIN";
      return;
    }

    // Process powerup movement and collection
    const powerupsToRemove: number[] = [];
    for (const powerupEntity of board.powerupEntities) {
      if (!gameModel.isActive(powerupEntity)) continue;

      const powerupTransform = gameModel.getTypedUnsafe(Transform, powerupEntity);
      powerupTransform.y += POWERUP_DROP_SPEED;

      // Check if powerup is collected by paddle
      const currentPaddleW = PADDLE_W * powerups.paddleWidthMult;
      if (
        powerupTransform.y + POWERUP_SIZE / 2 >= paddleTransform.y - PADDLE_H / 2 &&
        powerupTransform.y - POWERUP_SIZE / 2 <= paddleTransform.y + PADDLE_H / 2 &&
        powerupTransform.x >= paddleTransform.x - currentPaddleW / 2 &&
        powerupTransform.x <= paddleTransform.x + currentPaddleW / 2
      ) {
        const powerupTypeComponent = gameModel.getTypedUnsafe(PowerupType, powerupEntity);
        const powerupType = powerupTypeComponent.powerupType || "MULTIBALL";
        applyPowerup(gameModel, board, powerups, powerupType);
        powerupsToRemove.push(powerupEntity);
        continue;
      }

      // Remove powerups that fall off screen
      if (powerupTransform.y > FIELD_OFFSET_Y + FIELD_H + 50) {
        powerupsToRemove.push(powerupEntity);
      }
    }

    for (const powerupEntity of powerupsToRemove) {
      gameModel.removeEntity(powerupEntity);
      board.powerupEntities = board.powerupEntities.filter((e) => e !== powerupEntity);
    }
  };
}

// ── Format context ────────────────────────────────────────────────────────────

function formatContext(board: BreakoutBoard) {
  let statusMessage = `Score: ${board.score}  Lives: ${board.lives}`;
  if (board.status === "GAME_OVER") statusMessage = "Game Over!";
  if (board.status === "WIN") statusMessage = "You Win!";

  return {
    statusMessage,
    showGameOver: board.status !== "PLAYING",
  };
}

// ── Draw / UI System ──────────────────────────────────────────────────────────

@System(BreakoutBoard)
export class BreakoutUISystem extends DrawSystemImpl<ReadOnlyGameModel> {
  uiService: UIService;
  uiMap: UiMap;
  uiElements: UIElement[] = [];

  constructor(query: QueryInstance) {
    super(query);
    this.uiService = UIService.getInstance();
  }

  init = (gameModel: ReadOnlyGameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(BreakoutBoard, entity);
    const uiAsset = AssetLoader.getInstance().getUi(board.uiMap);
    this.uiMap = buildUiMap(uiAsset);

    const initialContext = formatContext(board);

    const eventHandler = (_playerIndex: number, eventName: string, _eventType: string, _context: any) => {
      if (eventName === "onRestartClick") {
        const mutableGameModel = gameModel as any as GameModel;
        const mutableBoard = mutableGameModel.getTypedUnsafe(BreakoutBoard, entity);
        const mutablePowerups = mutableGameModel.getTypedUnsafe(BreakoutPowerups, entity);
        restartGame(mutableGameModel, mutableBoard, mutablePowerups);
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
    const board = gameModel.getTypedUnsafe(BreakoutBoard, entity);
    this.uiMap.update(formatContext(board));
  };

  cleanup = () => {
    if (this.uiElements.length) {
      this.uiService.removeFromUI(this.uiElements);
      this.uiElements = [];
    }
  };
}