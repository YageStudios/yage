import { Component, defaultValue, DrawSystemImpl, Schema, System, SystemImpl, type } from "minecs";
import type { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import { Button, Column, CommandQueue, Grid, Model, Panel, Text, UIFinal, each, when } from "yage/ui/final";
import type { Child } from "yage/ui/final";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { keyPressed } from "yage/utils/keys";
import { canPresentUI } from "../../shared/uiFinal";

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
    // HUD restart commands are applied here — the authoritative gameplay input point.
    gameModel.getSystem(SnakeUISystem)?.commands.drain(command => {
      if (command.type !== "restart") return;
      resetGame(gameModel.getTypedUnsafe(SnakeBoard, entity), gameModel);
    });

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

// ── Presentation projection ───────────────────────────────────────────────────

const CELL_COLORS = { EMPTY: "#111111", HEAD: "#00ff00", BODY: "#00aa00", APPLE: "#ff2222" };

function boardCells(board: SnakeBoard): string[] {
  const cells = Array.from({ length: GRID_COLS * GRID_ROWS }, () => CELL_COLORS.EMPTY);

  for (let i = 2; i < board.snakeBody.length; i += 2) {
    const x = board.snakeBody[i];
    const y = board.snakeBody[i + 1];
    if (x >= 0 && x < GRID_COLS && y >= 0 && y < GRID_ROWS) {
      cells[y * GRID_COLS + x] = CELL_COLORS.BODY;
    }
  }

  if (board.snakeBody.length >= 2) {
    const hx = board.snakeBody[0];
    const hy = board.snakeBody[1];
    if (hx >= 0 && hx < GRID_COLS && hy >= 0 && hy < GRID_ROWS) {
      cells[hy * GRID_COLS + hx] = CELL_COLORS.HEAD;
    }
  }

  if (board.appleX >= 0 && board.appleX < GRID_COLS && board.appleY >= 0 && board.appleY < GRID_ROWS) {
    cells[board.appleY * GRID_COLS + board.appleX] = CELL_COLORS.APPLE;
  }
  return cells;
}

function statusMessage(board: SnakeBoard): string {
  if (board.status === "GAME_OVER") return "Game Over!";
  if (board.status === "WIN") return "You Win!";
  return `Score: ${board.score}`;
}

interface SnakeHudState {
  statusMessage: string;
  showGameOver: boolean;
  cells: string[];
}

// ── UI Final HUD ──────────────────────────────────────────────────────────────

@System(SnakeBoard)
export class SnakeUISystem extends DrawSystemImpl<ReadOnlyGameModel> {
  /** Commands from the HUD; drained by SnakeSystem at the gameplay input boundary. */
  readonly commands = new CommandQueue();
  private ui?: UIFinal;
  private state?: Model<SnakeHudState>;

  init = (_gameModel: ReadOnlyGameModel, _entity: number) => {
    // Headless runs (unit tests) have no real DOM; the HUD is presentation-only.
    if (!canPresentUI() || this.ui) return;
    const ui = (this.ui = new UIFinal());
    const state = (this.state = new Model<SnakeHudState>({
      statusMessage: "",
      showGameOver: false,
      cells: Array.from({ length: GRID_COLS * GRID_ROWS }, () => CELL_COLORS.EMPTY),
    }));
    ui.scope.add(() => { this.state = undefined; state.dispose(); });
    ui.mount(this.hud(state));
  };

  private hud(state: Model<SnakeHudState>): Child {
    return [
      Text(() => state.get<string>("statusMessage"), {
        id: "scoreText",
        style: {
          position: "absolute", top: 20, left: "50%", transform: "translateX(-50%)",
          fontSize: 36, color: "#00ff00", textAlign: "center", fontFamily: "monospace",
        },
      }),
      Grid({
        id: "fieldGrid",
        style: {
          position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
          gridTemplateColumns: `repeat(${GRID_COLS}, 24px)`, gap: 1, padding: 1,
          backgroundColor: "#0a0a0a", border: "2px solid #003300", borderRadius: 4,
        },
      }, each(state.select<readonly string[]>("cells"), (_, index) => index, color =>
        Panel({ style: { width: 24, height: 24, borderRadius: 2, background: () => color.get() } }))),
      Text("WASD or Arrow Keys to move", {
        style: {
          position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
          fontSize: 14, color: "#335533", textAlign: "center",
        },
      }),
      when(() => state.get<boolean>("showGameOver"), () =>
        Panel({
          id: "gameOver",
          style: { position: "absolute", inset: 0, display: "grid", placeItems: "center" },
        },
          Column({ style: { alignItems: "center", gap: 24 } },
            Text(() => state.get<string>("statusMessage"), {
              id: "gameOverText",
              style: {
                fontSize: 48, color: "#44ff44", textAlign: "center",
                textShadow: "0 0 20px #00ff00",
              },
            }),
            Button({
              id: "restart",
              autoFocus: true,
              style: {
                minWidth: 220, minHeight: 64, fontSize: 28,
                backgroundColor: "#4CAF50", color: "#ffffff", borderRadius: 8,
              },
              on: { activate: event => { this.commands.enqueue(event.player, "restart"); } },
            }, "Play Again")))),
    ];
  }

  run = (gameModel: ReadOnlyGameModel, entity: number) => {
    if (!this.state) return;
    const board = gameModel.getTypedUnsafe(SnakeBoard, entity);
    this.state.set("statusMessage", statusMessage(board));
    this.state.set("showGameOver", board.status !== "PLAYING");
    this.state.set("cells", boardCells(board));
  };

  cleanup = () => {
    this.ui?.dispose();
    this.ui = undefined;
  };
}