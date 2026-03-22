import { Component, defaultValue, DrawSystemImpl, QueryInstance, Schema, System, SystemImpl, type } from "minecs";
import type { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import { UIService } from "yage/ui/UIService";
import AssetLoader from "yage/loader/AssetLoader";
import type { UiMap } from "yage/ui/UiMap";
import { buildUiMap } from "yage/ui/UiMap";
import type { UIElement } from "yage/ui/UIElement";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { keyDown } from "yage/utils/keys";

// ── Constants ─────────────────────────────────────────────────────────────────

const FIELD_W = 800;
const FIELD_H = 600;
const PADDLE_W = 12;
const PADDLE_H = 80;
const BALL_SIZE = 12;
const PADDLE_SPEED = 6;
const WINNING_SCORE = 7;
const PADDLE_OFFSET = 30;

const COLS = 40;
const ROWS = 30;
const CELL_W = FIELD_W / COLS;
const CELL_H = FIELD_H / ROWS;

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

// ── Game Logic System ─────────────────────────────────────────────────────────

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
  };
}

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
        // Player 0: W/S or Up/Down for left paddle
        if (keyDown(["w", "up"], pi.keyMap)) {
          board.leftPaddleY -= PADDLE_SPEED;
        }
        if (keyDown(["s", "down"], pi.keyMap)) {
          board.leftPaddleY += PADDLE_SPEED;
        }
      } else if (i === 1) {
        // Player 1: W/S or Up/Down for right paddle
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
  };
}

// ── Render helpers ────────────────────────────────────────────────────────────

function formatContext(board: PongBoard) {
  const BG = "#111111";
  const PADDLE_COLOR = "#ffffff";
  const BALL_COLOR = "#ffff00";
  const NET_COLOR = "#333333";

  const cells = Array.from({ length: COLS * ROWS }, () => ({ color: BG }));

  const setCell = (cx: number, cy: number, color: string) => {
    if (cx >= 0 && cx < COLS && cy >= 0 && cy < ROWS) {
      cells[cy * COLS + cx] = { color };
    }
  };

  // Draw center line
  for (let r = 0; r < ROWS; r++) {
    if (r % 2 === 0) setCell(Math.floor(COLS / 2), r, NET_COLOR);
  }

  // Draw left paddle
  const lpStartRow = Math.floor(board.leftPaddleY / CELL_H);
  const lpEndRow = Math.floor((board.leftPaddleY + PADDLE_H) / CELL_H);
  const lpCol = Math.floor(PADDLE_OFFSET / CELL_W);
  for (let r = lpStartRow; r <= lpEndRow && r < ROWS; r++) {
    setCell(lpCol, r, PADDLE_COLOR);
    if (lpCol + 1 < COLS) setCell(lpCol + 1, r, PADDLE_COLOR);
  }

  // Draw right paddle
  const rpStartRow = Math.floor(board.rightPaddleY / CELL_H);
  const rpEndRow = Math.floor((board.rightPaddleY + PADDLE_H) / CELL_H);
  const rpCol = Math.floor((FIELD_W - PADDLE_OFFSET - PADDLE_W) / CELL_W);
  for (let r = rpStartRow; r <= rpEndRow && r < ROWS; r++) {
    setCell(rpCol, r, PADDLE_COLOR);
    if (rpCol - 1 >= 0) setCell(rpCol - 1, r, PADDLE_COLOR);
  }

  // Draw ball
  const bCol = Math.floor(board.ballX / CELL_W);
  const bRow = Math.floor(board.ballY / CELL_H);
  setCell(bCol, bRow, BALL_COLOR);

  let statusMessage = `${board.leftScore}  -  ${board.rightScore}`;
  if (board.status === "LEFT_WINS") statusMessage = "Left Player Wins!";
  if (board.status === "RIGHT_WINS") statusMessage = "Right Player Wins!";

  return {
    cells,
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