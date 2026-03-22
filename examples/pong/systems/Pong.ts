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

// ── Constants ─────────────────────────────────────────────────────────────────

const FIELD_W = 800;
const FIELD_H = 600;
const FIELD_OFFSET_X = (1920 - FIELD_W) / 2;
const FIELD_OFFSET_Y = (1080 - FIELD_H) / 2;
const PADDLE_W = 12;
const PADDLE_H = 80;
const BALL_SIZE = 12;
const PADDLE_SPEED = 6;
const WINNING_SCORE = 7;
const PADDLE_OFFSET = 30;

// ── Component ─────────────────────────────────────────────────────────────────

@Component()
export class PongBoard extends Schema {
  @type("number")
  @defaultValue(0)
  leftScore: number;

  @type("number")
  @defaultValue(0)
  rightScore: number;

  @type("string")
  @defaultValue("PLAYING")
  status: string;

  @type("float32")
  @defaultValue(4)
  ballVx: number;

  @type("float32")
  @defaultValue(2)
  ballVy: number;

  @type("float32")
  @defaultValue(400)
  ballX: number;

  @type("float32")
  @defaultValue(300)
  ballY: number;

  @type("float32")
  @defaultValue(250)
  leftPaddleY: number;

  @type("float32")
  @defaultValue(250)
  rightPaddleY: number;

  @type("number")
  @defaultValue(-1)
  leftPaddleEntity: number;

  @type("number")
  @defaultValue(-1)
  rightPaddleEntity: number;

  @type("number")
  @defaultValue(-1)
  ballEntity: number;

  @type(["number"])
  @defaultValue([])
  netEntities: number[];

  @type("string")
  @defaultValue("PongUI")
  uiMap: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetBall(board: PongBoard, gameModel: GameModel): void {
  board.ballX = FIELD_W / 2;
  board.ballY = FIELD_H / 2;
  const dir = gameModel.rand.int(0, 1) === 0 ? 1 : -1;
  const angle = gameModel.rand.float(-0.5, 0.5);
  const speed = 4;
  board.ballVx = speed * dir;
  board.ballVy = speed * angle;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── Init System ───────────────────────────────────────────────────────────────

@System(PongBoard)
export class PongInitSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = -100;

  init = (gameModel: GameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(PongBoard, entity);
    resetBall(board, gameModel);
    board.leftPaddleY = (FIELD_H - PADDLE_H) / 2;
    board.rightPaddleY = (FIELD_H - PADDLE_H) / 2;
    board.leftScore = 0;
    board.rightScore = 0;
    board.status = "PLAYING";

    // Spawn left paddle entity
    const leftPaddle = EntityFactory.getInstance().generateEntity(gameModel, "PongPaddle");
    const leftT = gameModel.getTypedUnsafe(Transform, leftPaddle);
    leftT.x = FIELD_OFFSET_X + PADDLE_OFFSET + PADDLE_W / 2;
    leftT.y = FIELD_OFFSET_Y + board.leftPaddleY + PADDLE_H / 2;
    board.leftPaddleEntity = leftPaddle;

    // Spawn right paddle entity
    const rightPaddle = EntityFactory.getInstance().generateEntity(gameModel, "PongPaddle");
    const rightT = gameModel.getTypedUnsafe(Transform, rightPaddle);
    rightT.x = FIELD_OFFSET_X + FIELD_W - PADDLE_OFFSET - PADDLE_W / 2;
    rightT.y = FIELD_OFFSET_Y + board.rightPaddleY + PADDLE_H / 2;
    board.rightPaddleEntity = rightPaddle;

    // Spawn ball entity
    const ball = EntityFactory.getInstance().generateEntity(gameModel, "PongBall");
    const ballT = gameModel.getTypedUnsafe(Transform, ball);
    ballT.x = FIELD_OFFSET_X + board.ballX + BALL_SIZE / 2;
    ballT.y = FIELD_OFFSET_Y + board.ballY + BALL_SIZE / 2;
    board.ballEntity = ball;

    // Spawn center net dashes
    const netEntities: number[] = [];
    for (let y = 0; y < FIELD_H; y += 20) {
      if (Math.floor(y / 20) % 2 !== 0) continue;
      const net = EntityFactory.getInstance().generateEntity(gameModel, "PongNet");
      const netT = gameModel.getTypedUnsafe(Transform, net);
      netT.x = FIELD_OFFSET_X + FIELD_W / 2;
      netT.y = FIELD_OFFSET_Y + y + 5;
      netEntities.push(net);
    }
    board.netEntities = netEntities;
  };
}

// ── Game Logic System ─────────────────────────────────────────────────────────

@System(PongBoard)
export class PongSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = 0;

  run = (gameModel: GameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(PongBoard, entity);
    if (board.status !== "PLAYING") return;

    // Read input from both players
    const playerEntities = gameModel.getComponentActives("PlayerInput");

    for (let i = 0; i < playerEntities.length; i++) {
      const pi = gameModel.getTypedUnsafe(PlayerInput, playerEntities[i]);
      if (!pi.keyMap) continue;

      if (i === 0) {
        if (keyDown(["w", "up"], pi.keyMap)) {
          board.leftPaddleY -= PADDLE_SPEED;
        }
        if (keyDown(["s", "down"], pi.keyMap)) {
          board.leftPaddleY += PADDLE_SPEED;
        }
      } else if (i === 1) {
        if (keyDown(["w", "up"], pi.keyMap)) {
          board.rightPaddleY -= PADDLE_SPEED;
        }
        if (keyDown(["s", "down"], pi.keyMap)) {
          board.rightPaddleY += PADDLE_SPEED;
        }
      }
    }

    // If only 1 player, AI controls right paddle
    if (playerEntities.length < 2) {
      const targetY = board.ballY - PADDLE_H / 2;
      const diff = targetY - board.rightPaddleY;
      board.rightPaddleY += clamp(diff, -PADDLE_SPEED * 0.7, PADDLE_SPEED * 0.7);
    }

    // Clamp paddles
    board.leftPaddleY = clamp(board.leftPaddleY, 0, FIELD_H - PADDLE_H);
    board.rightPaddleY = clamp(board.rightPaddleY, 0, FIELD_H - PADDLE_H);

    // Move ball
    board.ballX += board.ballVx;
    board.ballY += board.ballVy;

    // Top/bottom bounce
    if (board.ballY <= 0) {
      board.ballY = 0;
      board.ballVy = Math.abs(board.ballVy);
    }
    if (board.ballY >= FIELD_H - BALL_SIZE) {
      board.ballY = FIELD_H - BALL_SIZE;
      board.ballVy = -Math.abs(board.ballVy);
    }

    // Left paddle collision
    if (
      board.ballX <= PADDLE_OFFSET + PADDLE_W &&
      board.ballX >= PADDLE_OFFSET &&
      board.ballY + BALL_SIZE >= board.leftPaddleY &&
      board.ballY <= board.leftPaddleY + PADDLE_H
    ) {
      board.ballX = PADDLE_OFFSET + PADDLE_W;
      const hitPos = (board.ballY + BALL_SIZE / 2 - board.leftPaddleY) / PADDLE_H;
      const angle = (hitPos - 0.5) * 2.5;
      const speed = Math.sqrt(board.ballVx * board.ballVx + board.ballVy * board.ballVy) + 0.15;
      board.ballVx = Math.abs(speed * Math.cos(angle));
      board.ballVy = speed * Math.sin(angle);
    }

    // Right paddle collision
    if (
      board.ballX + BALL_SIZE >= FIELD_W - PADDLE_OFFSET - PADDLE_W &&
      board.ballX + BALL_SIZE <= FIELD_W - PADDLE_OFFSET &&
      board.ballY + BALL_SIZE >= board.rightPaddleY &&
      board.ballY <= board.rightPaddleY + PADDLE_H
    ) {
      board.ballX = FIELD_W - PADDLE_OFFSET - PADDLE_W - BALL_SIZE;
      const hitPos = (board.ballY + BALL_SIZE / 2 - board.rightPaddleY) / PADDLE_H;
      const angle = (hitPos - 0.5) * 2.5;
      const speed = Math.sqrt(board.ballVx * board.ballVx + board.ballVy * board.ballVy) + 0.15;
      board.ballVx = -Math.abs(speed * Math.cos(angle));
      board.ballVy = speed * Math.sin(angle);
    }

    // Scoring
    if (board.ballX < 0) {
      board.rightScore++;
      if (board.rightScore >= WINNING_SCORE) {
        board.status = "RIGHT_WINS";
      } else {
        resetBall(board, gameModel);
      }
    }
    if (board.ballX > FIELD_W) {
      board.leftScore++;
      if (board.leftScore >= WINNING_SCORE) {
        board.status = "LEFT_WINS";
      } else {
        resetBall(board, gameModel);
      }
    }

    // Sync entity positions
    if (board.leftPaddleEntity !== -1) {
      const t = gameModel.getTypedUnsafe(Transform, board.leftPaddleEntity);
      t.y = FIELD_OFFSET_Y + board.leftPaddleY + PADDLE_H / 2;
    }
    if (board.rightPaddleEntity !== -1) {
      const t = gameModel.getTypedUnsafe(Transform, board.rightPaddleEntity);
      t.y = FIELD_OFFSET_Y + board.rightPaddleY + PADDLE_H / 2;
    }
    if (board.ballEntity !== -1) {
      const t = gameModel.getTypedUnsafe(Transform, board.ballEntity);
      t.x = FIELD_OFFSET_X + board.ballX + BALL_SIZE / 2;
      t.y = FIELD_OFFSET_Y + board.ballY + BALL_SIZE / 2;
    }
  };
}

// ── Format context ───────────────────────────────────────────────────────────

function formatContext(board: PongBoard) {
  let statusMessage = `${board.leftScore}  -  ${board.rightScore}`;
  if (board.status === "LEFT_WINS") statusMessage = "Left Player Wins!";
  if (board.status === "RIGHT_WINS") statusMessage = "Right Player Wins!";

  return {
    statusMessage,
    showGameOver: board.status !== "PLAYING",
  };
}

// ── Draw / UI System ──────────────────────────────────────────────────────────

@System(PongBoard)
export class PongUISystem extends DrawSystemImpl<ReadOnlyGameModel> {
  uiService: UIService;
  uiMap: UiMap;
  uiElements: UIElement[] = [];

  constructor(query: QueryInstance) {
    super(query);
    this.uiService = UIService.getInstance();
  }

  init = (gameModel: ReadOnlyGameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(PongBoard, entity);
    const uiAsset = AssetLoader.getInstance().getUi(board.uiMap);
    this.uiMap = buildUiMap(uiAsset);

    const initialContext = formatContext(board);

    const eventHandler = (playerIndex: number, eventName: string, _eventType: string, _context: any) => {
      if (eventName === "onRestartClick") {
        const mutableGameModel = gameModel as any as GameModel;
        const mutableBoard = mutableGameModel.getTypedUnsafe(PongBoard, entity);
        mutableBoard.leftScore = 0;
        mutableBoard.rightScore = 0;
        mutableBoard.status = "PLAYING";
        resetBall(mutableBoard, mutableGameModel);
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
    const board = gameModel.getTypedUnsafe(PongBoard, entity);
    this.uiMap.update(formatContext(board));
  };

  cleanup = () => {
    if (this.uiElements.length) {
      this.uiService.removeFromUI(this.uiElements);
      this.uiElements = [];
    }
  };
}