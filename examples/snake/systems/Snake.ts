import { Component, defaultValue, DrawSystemImpl, QueryInstance, Schema, System, SystemImpl, type } from "minecs";
import type { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import { UIService } from "yage/ui/UIService";
import AssetLoader from "yage/loader/AssetLoader";
import type { UiMap } from "yage/ui/UiMap";
import { buildUiMap } from "yage/ui/UiMap";
import type { UIElement } from "yage/ui/UIElement";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { keyPressed } from "yage/utils/keys";

// ── Constants ─────────────────────────────────────────────────────────────────

const GRID_COLS = 20;
const GRID_ROWS = 20;
const TICK_FRAMES = 8; // snake moves every N frames

// ── Component ─────────────────────────────────────────────────────────────────

@Component()
export class SnakeBoard extends Schema {
  @type("string")
  @defaultValue("PLAYING")
  status: string;

  @type("number")
  @defaultValue(0)
  score: number;

  // Direction: 0=right, 1=down, 2=left, 3=up
  @type("number")
  @defaultValue(0)
  direction: number;

  @type("number")
  @defaultValue(0)
  nextDirection: number;

  // Snake body stored as flat array of [x, y, x, y, ...]
  @type(["number"])
  @defaultValue([])
  snakeBody: number[];

  // Apple position
  @type("number")
  @defaultValue(0)
  appleX: number;

  @type("number")
  @defaultValue(0)
  appleY: number;

  @type("number")
  @defaultValue(0)
  tickTimer: number;

  @type("string")
  @defaultValue("SnakeUI")
  uiMap: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const DX = [1, 0, -1, 0];
const DY = [0, 1, 0, -1];

function spawnApple(board: SnakeBoard, gameModel: GameModel): void {
  const occupied = new Set<number>();
  for (let i = 0; i < board.snakeBody.length; i += 2) {
    occupied.add(board.snakeBody[i] * GRID_ROWS + board.snakeBody[i + 1]);
  }

  const free: number[] = [];
  for (let x = 0; x < GRID_COLS; x++) {
    for (let y = 0; y < GRID_ROWS; y++) {
      if (!occupied.has(x * GRID_ROWS + y)) {
        free.push(x * GRID_ROWS + y);
      }
    }
  }
  if (free.length === 0) {
    board.status = "WIN";
    return;
  }
  const idx = free[gameModel.rand.int(0, free.length - 1)];
  board.appleX = Math.floor(idx / GRID_ROWS);
  board.appleY = idx % GRID_ROWS;
}

function resetGame(board: SnakeBoard, gameModel: GameModel): void {
  const startX = Math.floor(GRID_COLS / 2);
  const startY = Math.floor(GRID_ROWS / 2);
  board.snakeBody = [startX, startY, startX - 1, startY, startX - 2, startY];
  board.direction = 0;
  board.nextDirection = 0;
  board.score = 0;
  board.status = "PLAYING";
  board.tickTimer = TICK_FRAMES;
  spawnApple(board, gameModel);
}

// ── Init System ───────────────────────────────────────────────────────────────

@System(SnakeBoard)
export class SnakeInitSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = -100;

  init = (gameModel: GameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(SnakeBoard, entity);
    resetGame(board, gameModel);
  };
}

// ── Game Logic System ─────────────────────────────────────────────────────────

@System(SnakeBoard)
export class SnakeSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = 0;

  run = (gameModel: GameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(SnakeBoard, entity);
    if (board.status !== "PLAYING") return;

    // Read input
    const playerEntities = gameModel.getComponentActives("PlayerInput");
    if (playerEntities.length > 0) {
      const pi = gameModel.getTypedUnsafe(PlayerInput, playerEntities[0]);
      if (pi.keyMap) {
        const prev = pi.prevKeyMap ?? new Map<string, boolean>();

        if (keyPressed(["up", "w"], pi.keyMap, prev) && board.direction !== 1) {
          board.nextDirection = 3;
        } else if (keyPressed(["down", "s"], pi.keyMap, prev) && board.direction !== 3) {
          board.nextDirection = 1;
        } else if (keyPressed(["left", "a"], pi.keyMap, prev) && board.direction !== 0) {
          board.nextDirection = 2;
        } else if (keyPressed(["right", "d"], pi.keyMap, prev) && board.direction !== 2) {
          board.nextDirection = 0;
        }
      }
    }

    // Tick-based movement
    board.tickTimer--;
    if (board.tickTimer > 0) return;
    board.tickTimer = TICK_FRAMES;

    board.direction = board.nextDirection;

    const headX = board.snakeBody[0];
    const headY = board.snakeBody[1];
    const newX = headX + DX[board.direction];
    const newY = headY + DY[board.direction];

    // Wall collision
    if (newX < 0 || newX >= GRID_COLS || newY < 0 || newY >= GRID_ROWS) {
      board.status = "GAME_OVER";
      return;
    }

    // Self collision
    for (let i = 0; i < board.snakeBody.length; i += 2) {
      if (board.snakeBody[i] === newX && board.snakeBody[i + 1] === newY) {
        board.status = "GAME_OVER";
        return;
      }
    }

    // Move snake (add head, maybe remove tail)
    const newBody = [newX, newY, ...board.snakeBody];

    if (newX === board.appleX && newY === board.appleY) {
      // Eat apple: don't remove tail
      board.score += 10;
      board.snakeBody = newBody;
      spawnApple(board, gameModel);
    } else {
      // Normal move: remove last segment
      newBody.pop();
      newBody.pop();
      board.snakeBody = newBody;
    }
  };
}

// ── Format context ────────────────────────────────────────────────────────────

function formatContext(board: SnakeBoard) {
  const EMPTY = "#111111";
  const SNAKE_HEAD = "#00ff00";
  const SNAKE_BODY = "#00aa00";
  const APPLE = "#ff2222";

  const cells = Array.from({ length: GRID_COLS * GRID_ROWS }, () => ({ color: EMPTY }));

  // Draw snake body (skip head)
  for (let i = 2; i < board.snakeBody.length; i += 2) {
    const x = board.snakeBody[i];
    const y = board.snakeBody[i + 1];
    if (x >= 0 && x < GRID_COLS && y >= 0 && y < GRID_ROWS) {
      cells[y * GRID_COLS + x] = { color: SNAKE_BODY };
    }
  }

  // Draw head
  if (board.snakeBody.length >= 2) {
    const hx = board.snakeBody[0];
    const hy = board.snakeBody[1];
    if (hx >= 0 && hx < GRID_COLS && hy >= 0 && hy < GRID_ROWS) {
      cells[hy * GRID_COLS + hx] = { color: SNAKE_HEAD };
    }
  }

  // Draw apple
  if (board.appleX >= 0 && board.appleX < GRID_COLS && board.appleY >= 0 && board.appleY < GRID_ROWS) {
    cells[board.appleY * GRID_COLS + board.appleX] = { color: APPLE };
  }

  let statusMessage = `Score: ${board.score}`;
  if (board.status === "GAME_OVER") statusMessage = "Game Over!";
  if (board.status === "WIN") statusMessage = "You Win!";

  return {
    cells,
    statusMessage,
    score: board.score.toString(),
    showGameOver: board.status !== "PLAYING",
  };
}

// ── Draw / UI System ──────────────────────────────────────────────────────────

@System(SnakeBoard)
export class SnakeUISystem extends DrawSystemImpl<ReadOnlyGameModel> {
  uiService: UIService;
  uiMap: UiMap;
  uiElements: UIElement[] = [];

  constructor(query: QueryInstance) {
    super(query);
    this.uiService = UIService.getInstance();
  }

  init = (gameModel: ReadOnlyGameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(SnakeBoard, entity);
    const uiAsset = AssetLoader.getInstance().getUi(board.uiMap);
    this.uiMap = buildUiMap(uiAsset);

    const initialContext = formatContext(board);

    const eventHandler = (playerIndex: number, eventName: string, _eventType: string, _context: any) => {
      if (eventName === "onRestartClick") {
        const mutableGameModel = gameModel as any as GameModel;
        const mutableBoard = mutableGameModel.getTypedUnsafe(SnakeBoard, entity);
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
    const board = gameModel.getTypedUnsafe(SnakeBoard, entity);
    this.uiMap.update(formatContext(board));
  };

  cleanup = () => {
    if (this.uiElements.length) {
      this.uiService.removeFromUI(this.uiElements);
      this.uiElements = [];
    }
  };
}