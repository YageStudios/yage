import { Component, defaultValue, DrawSystemImpl, Schema, System, SystemImpl, type } from "minecs";
import type { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import { Button, Column, CommandQueue, Grid, Model, Panel, Text, UIFinal, each, when } from "yage/ui/final";
import type { Child } from "yage/ui/final";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { keyPressed } from "yage/utils/keys";
import { canPresentUI } from "../../shared/uiFinal";

// ── Constants ─────────────────────────────────────────────────────────────────
// Flappy Bird style platformer

const FIELD_W = 400;
const FIELD_H = 600;
const GRID_COLS = 20;
const GRID_ROWS = 30;

const BIRD_X = 80; // fixed horizontal position
const BIRD_SIZE = 12;
const GRAVITY = 0.4;
const JUMP_VELOCITY = -7;
const PIPE_WIDTH = 40;
const PIPE_GAP = 120;
const PIPE_SPEED = 2.5;
const PIPE_SPAWN_INTERVAL = 90;
const GROUND_Y = FIELD_H - 40;

// ── Component ─────────────────────────────────────────────────────────────────

@Component()
export class PlatformerBoard extends Schema {
  @type("string")
  @defaultValue("WAITING")
  status: string; // WAITING, PLAYING, GAME_OVER

  @type("number")
  @defaultValue(0)
  score: number;

  @type("number")
  @defaultValue(0)
  bestScore: number;

  @type("float32")
  @defaultValue(250)
  birdY: number;

  @type("float32")
  @defaultValue(0)
  birdVy: number;

  // Pipes stored flat: [x, gapCenterY, scored, ...]
  @type(["float32"])
  @defaultValue([])
  pipes: number[];

  @type("number")
  @defaultValue(0)
  pipeTimer: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetGame(board: PlatformerBoard): void {
  board.birdY = FIELD_H / 3;
  board.birdVy = 0;
  board.pipes = [];
  board.pipeTimer = 0;
  board.score = 0;
  board.status = "WAITING";
}

function spawnPipe(board: PlatformerBoard, gameModel: GameModel): void {
  const minGapY = PIPE_GAP / 2 + 40;
  const maxGapY = GROUND_Y - PIPE_GAP / 2 - 20;
  const gapCenterY = gameModel.rand.float(minGapY, maxGapY);
  board.pipes = [...board.pipes, FIELD_W, gapCenterY, 0];
}

// ── Init System ───────────────────────────────────────────────────────────────

@System(PlatformerBoard)
export class PlatformerInitSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = -100;

  init = (_gameModel: GameModel, entity: number) => {
    const board = _gameModel.getTypedUnsafe(PlatformerBoard, entity);
    resetGame(board);
  };
}

// ── Game Logic System ─────────────────────────────────────────────────────────

@System(PlatformerBoard)
export class PlatformerSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = 0;

  run = (gameModel: GameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(PlatformerBoard, entity);

    // HUD restart commands are applied here — the authoritative gameplay input point.
    gameModel.getSystem(PlatformerUISystem)?.commands.drain(command => {
      if (command.type !== "restart") return;
      resetGame(gameModel.getTypedUnsafe(PlatformerBoard, entity));
    });

    // Read input
    const playerEntities = gameModel.getComponentActives("PlayerInput");
    let flap = false;
    if (playerEntities.length > 0) {
      const pi = gameModel.getTypedUnsafe(PlayerInput, playerEntities[0]);
      if (pi.keyMap) {
        flap = keyPressed(["space", "up", "w"], pi.keyMap, pi.prevKeyMap ?? new Map());
      }
    }

    if (board.status === "GAME_OVER") return;

    if (board.status === "WAITING") {
      if (flap) {
        board.status = "PLAYING";
        board.birdVy = JUMP_VELOCITY;
      }
      return;
    }

    // Playing
    if (flap) {
      board.birdVy = JUMP_VELOCITY;
    }

    // Apply gravity
    board.birdVy += GRAVITY;
    board.birdY += board.birdVy;

    // Ceiling
    if (board.birdY < 0) {
      board.birdY = 0;
      board.birdVy = 0;
    }

    // Ground collision
    if (board.birdY + BIRD_SIZE >= GROUND_Y) {
      board.birdY = GROUND_Y - BIRD_SIZE;
      board.status = "GAME_OVER";
      if (board.score > board.bestScore) board.bestScore = board.score;
      return;
    }

    // Spawn pipes
    board.pipeTimer++;
    if (board.pipeTimer >= PIPE_SPAWN_INTERVAL) {
      board.pipeTimer = 0;
      spawnPipe(board, gameModel);
    }

    // Update pipes
    const newPipes: number[] = [];
    for (let i = 0; i < board.pipes.length; i += 3) {
      const px = board.pipes[i] - PIPE_SPEED;
      const gapY = board.pipes[i + 1];
      let scored = board.pipes[i + 2];

      // Remove off-screen pipes
      if (px + PIPE_WIDTH < 0) continue;

      // Score when bird passes pipe
      if (scored === 0 && px + PIPE_WIDTH < BIRD_X) {
        scored = 1;
        board.score++;
      }

      // Collision detection
      if (BIRD_X + BIRD_SIZE > px && BIRD_X < px + PIPE_WIDTH) {
        const topPipeBottom = gapY - PIPE_GAP / 2;
        const bottomPipeTop = gapY + PIPE_GAP / 2;
        if (board.birdY < topPipeBottom || board.birdY + BIRD_SIZE > bottomPipeTop) {
          board.status = "GAME_OVER";
          if (board.score > board.bestScore) board.bestScore = board.score;
          return;
        }
      }

      newPipes.push(px, gapY, scored);
    }
    board.pipes = newPipes;
  };
}

// ── Presentation projection ───────────────────────────────────────────────────

const CELL_COLORS = { BG: "#87CEEB", BIRD: "#FFD700", PIPE: "#228B22", GROUND: "#8B4513", GROUND_TOP: "#567d46" };

function boardCells(board: PlatformerBoard): string[] {
  const cells = Array.from({ length: GRID_COLS * GRID_ROWS }, () => CELL_COLORS.BG);

  const setCell = (cx: number, cy: number, color: string) => {
    if (cx >= 0 && cx < GRID_COLS && cy >= 0 && cy < GRID_ROWS) {
      cells[cy * GRID_COLS + cx] = color;
    }
  };

  const xScale = GRID_COLS / FIELD_W;
  const yScale = GRID_ROWS / FIELD_H;

  // Draw ground
  const groundRow = Math.floor(GROUND_Y * yScale);
  for (let x = 0; x < GRID_COLS; x++) {
    setCell(x, groundRow, CELL_COLORS.GROUND_TOP);
    for (let y = groundRow + 1; y < GRID_ROWS; y++) {
      setCell(x, y, CELL_COLORS.GROUND);
    }
  }

  // Draw pipes
  for (let i = 0; i < board.pipes.length; i += 3) {
    const px = board.pipes[i];
    const gapY = board.pipes[i + 1];
    const col1 = Math.floor(px * xScale);
    const col2 = Math.floor((px + PIPE_WIDTH) * xScale);
    const gapTopRow = Math.floor((gapY - PIPE_GAP / 2) * yScale);
    const gapBottomRow = Math.floor((gapY + PIPE_GAP / 2) * yScale);

    for (let c = col1; c <= col2 && c < GRID_COLS; c++) {
      if (c < 0) continue;
      // Top pipe
      for (let r = 0; r < gapTopRow; r++) {
        setCell(c, r, CELL_COLORS.PIPE);
      }
      // Bottom pipe
      for (let r = gapBottomRow; r < groundRow; r++) {
        setCell(c, r, CELL_COLORS.PIPE);
      }
    }
  }

  // Draw bird
  const bx = Math.floor(BIRD_X * xScale);
  const by = Math.floor(board.birdY * yScale);
  setCell(bx, by, CELL_COLORS.BIRD);
  setCell(bx + 1, by, CELL_COLORS.BIRD);
  if (by + 1 < GRID_ROWS) {
    setCell(bx, by + 1, CELL_COLORS.BIRD);
    setCell(bx + 1, by + 1, CELL_COLORS.BIRD);
  }
  return cells;
}

function statusMessage(board: PlatformerBoard): string {
  if (board.status === "WAITING") return "Press Space to Start";
  if (board.status === "GAME_OVER") return `Game Over! Score: ${board.score} Best: ${board.bestScore}`;
  return `Score: ${board.score}`;
}

interface PlatformerHudState {
  statusMessage: string;
  showGameOver: boolean;
  cells: string[];
}

// ── UI Final HUD ──────────────────────────────────────────────────────────────

@System(PlatformerBoard)
export class PlatformerUISystem extends DrawSystemImpl<ReadOnlyGameModel> {
  /** Commands from the HUD; drained by PlatformerSystem at the gameplay input boundary. */
  readonly commands = new CommandQueue();
  private ui?: UIFinal;
  private state?: Model<PlatformerHudState>;

  init = (_gameModel: ReadOnlyGameModel, _entity: number) => {
    // Headless runs (unit tests) have no real DOM; the HUD is presentation-only.
    if (!canPresentUI() || this.ui) return;
    const ui = (this.ui = new UIFinal());
    const state = (this.state = new Model<PlatformerHudState>({
      statusMessage: "",
      showGameOver: false,
      cells: Array.from({ length: GRID_COLS * GRID_ROWS }, () => CELL_COLORS.BG),
    }));
    ui.scope.add(() => { this.state = undefined; state.dispose(); });
    ui.mount(this.hud(state));
  };

  private hud(state: Model<PlatformerHudState>): Child {
    return [
      Text(() => state.get<string>("statusMessage"), {
        id: "statusText",
        style: {
          position: "absolute", top: 15, left: "50%", transform: "translateX(-50%)",
          fontSize: 32, color: "#ffffff", textAlign: "center",
          textShadow: "2px 2px 4px rgba(0,0,0,0.5)",
        },
      }),
      Grid({
        id: "fieldGrid",
        style: {
          position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
          gridTemplateColumns: `repeat(${GRID_COLS}, 20px)`, gap: 0, padding: 1,
          backgroundColor: "#87CEEB", border: "2px solid #4A90D9", borderRadius: 4,
        },
      }, each(state.select<readonly string[]>("cells"), (_, index) => index, color =>
        Panel({ style: { width: 20, height: 20, background: () => color.get() } }))),
      Text("Space / ↑ to flap", {
        style: {
          position: "absolute", bottom: 15, left: "50%", transform: "translateX(-50%)",
          fontSize: 14, color: "#335577", textAlign: "center",
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
                fontSize: 36, color: "#ff2222", textAlign: "center",
                textShadow: "0 0 10px #ff0000",
              },
            }),
            Button({
              id: "restart",
              autoFocus: true,
              style: {
                minWidth: 220, minHeight: 64, fontSize: 28,
                backgroundColor: "#FFD700", color: "#333333", borderRadius: 8,
              },
              on: { activate: event => { this.commands.enqueue(event.player, "restart"); } },
            }, "Play Again")))),
    ];
  }

  run = (gameModel: ReadOnlyGameModel, entity: number) => {
    if (!this.state) return;
    const board = gameModel.getTypedUnsafe(PlatformerBoard, entity);
    this.state.set("statusMessage", statusMessage(board));
    this.state.set("showGameOver", board.status === "GAME_OVER");
    this.state.set("cells", boardCells(board));
  };

  cleanup = () => {
    this.ui?.dispose();
    this.ui = undefined;
  };
}