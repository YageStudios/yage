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

  @type("string")
  @defaultValue("BreakoutUI")
  uiMap: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function createWall(gameModel: GameModel, x: number, y: number, w: number, h: number): void {
  const wall = EntityFactory.getInstance().generateEntity(gameModel, "BreakoutWall");
  const t = gameModel.getTypedUnsafe(Transform, wall);
  t.x = x;
  t.y = y;
  const rb = gameModel.getTypedUnsafe(RigidBox, wall);
  rb.width = w;
  rb.height = h;
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
  if (board.ballEntity === -1 || board.paddleEntity === -1) return;
  const paddleTransform = gameModel.getTypedUnsafe(Transform, board.paddleEntity);
  const ballTransform = gameModel.getTypedUnsafe(Transform, board.ballEntity);
  ballTransform.x = paddleTransform.x;
  ballTransform.y = PADDLE_Y - PADDLE_H / 2 - BALL_RADIUS - 2;
  const ballLoco = gameModel.getTypedUnsafe(Locomotion, board.ballEntity);
  ballLoco.x = 0;
  ballLoco.y = 0;
  board.ballAttached = true;
}

function restartGame(gameModel: GameModel, board: BreakoutBoard): void {
  for (const brickEntity of board.brickEntities) {
    gameModel.removeEntity(brickEntity);
  }
  board.brickEntities = [];

  if (board.paddleEntity !== -1) {
    const paddleTransform = gameModel.getTypedUnsafe(Transform, board.paddleEntity);
    paddleTransform.x = FIELD_OFFSET_X + FIELD_W / 2;
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
    board.ballAttached = true;

    // Create bricks
    spawnBricks(gameModel, board);

    // Create invisible walls: top, left, right
    createWall(
      gameModel,
      FIELD_OFFSET_X + FIELD_W / 2,
      FIELD_OFFSET_Y - WALL_T / 2,
      FIELD_W + WALL_T * 2,
      WALL_T,
    );
    createWall(
      gameModel,
      FIELD_OFFSET_X - WALL_T / 2,
      FIELD_OFFSET_Y + FIELD_H / 2,
      WALL_T,
      FIELD_H + WALL_T * 2,
    );
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
    if (board.status !== "PLAYING") return;

    const ballEntity = board.ballEntity;
    const paddleEntity = board.paddleEntity;
    if (ballEntity === -1 || paddleEntity === -1) return;

    const paddleTransform = gameModel.getTypedUnsafe(Transform, paddleEntity);

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
          const ballLoco = gameModel.getTypedUnsafe(Locomotion, ballEntity);
          ballLoco.x = BALL_VX;
          ballLoco.y = BALL_VY;
        }
      }
    }

    paddleTransform.x = clamp(paddleTransform.x, FIELD_OFFSET_X + PADDLE_W / 2, FIELD_OFFSET_X + FIELD_W - PADDLE_W / 2);

    // Ball follows paddle when attached
    if (board.ballAttached) {
      const ballTransform = gameModel.getTypedUnsafe(Transform, ballEntity);
      ballTransform.x = paddleTransform.x;
      ballTransform.y = PADDLE_Y - PADDLE_H / 2 - BALL_RADIUS - 2;
      return;
    }

    // Check physics-engine collisions with bricks
    const collisions = gameModel.getTypedUnsafe(Collisions, gameModel.coreEntity);
    const collisionMap = collisions.collisionMap;
    const ballCollisions = collisionMap[ballEntity];

    if (ballCollisions && board.brickEntities.length > 0) {
      const toRemove: number[] = [];
      for (let i = 0; i < board.brickEntities.length; i++) {
        const brickEntity = board.brickEntities[i];
        if (ballCollisions[brickEntity]) {
          toRemove.push(brickEntity);
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

    // Check win
    if (board.brickEntities.length === 0) {
      board.status = "WIN";
      return;
    }

    // Check ball out of bounds (fell below field)
    const ballTransform = gameModel.getTypedUnsafe(Transform, ballEntity);
    if (ballTransform.y > FIELD_OFFSET_Y + FIELD_H + 50) {
      board.lives--;
      if (board.lives <= 0) {
        board.status = "GAME_OVER";
      } else {
        resetBall(gameModel, board);
      }
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
        restartGame(mutableGameModel, mutableBoard);
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