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

  @type("string")
  @defaultValue("PlatformerUI")
  uiMap: string;
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

// ── Format context ────────────────────────────────────────────────────────────

function formatContext(board: PlatformerBoard) {
  const BG = "#87CEEB"; // sky blue
  const BIRD_COLOR = "#FFD700";
  const PIPE_COLOR = "#228B22";
  const GROUND_COLOR = "#8B4513";
  const GROUND_TOP = "#567d46";

  const cells = Array.from({ length: GRID_COLS * GRID_ROWS }, () => ({ color: BG }));

  const setCell = (cx: number, cy: number, color: string) => {
    if (cx >= 0 && cx < GRID_COLS && cy >= 0 && cy < GRID_ROWS) {
      cells[cy * GRID_COLS + cx] = { color };
    }
  };

  const xScale = GRID_COLS / FIELD_W;
  const yScale = GRID_ROWS / FIELD_H;

  // Draw ground
  const groundRow = Math.floor(GROUND_Y * yScale);
  for (let x = 0; x < GRID_COLS; x++) {
    setCell(x, groundRow, GROUND_TOP);
    for (let y = groundRow + 1; y < GRID_ROWS; y++) {
      setCell(x, y, GROUND_COLOR);
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
        setCell(c, r, PIPE_COLOR);
      }
      // Bottom pipe
      for (let r = gapBottomRow; r < groundRow; r++) {
        setCell(c, r, PIPE_COLOR);
      }
    }
  }

  // Draw bird
  const bx = Math.floor(BIRD_X * xScale);
  const by = Math.floor(board.birdY * yScale);
  setCell(bx, by, BIRD_COLOR);
  setCell(bx + 1, by, BIRD_COLOR);
  if (by + 1 < GRID_ROWS) {
    setCell(bx, by + 1, BIRD_COLOR);
    setCell(bx + 1, by + 1, BIRD_COLOR);
  }

  let statusMessage = `Score: ${board.score}`;
  if (board.status === "WAITING") statusMessage = "Press Space to Start";
  if (board.status === "GAME_OVER") statusMessage = `Game Over! Score: ${board.score} Best: ${board.bestScore}`;

  return {
    cells,
    statusMessage,
    showGameOver: board.status === "GAME_OVER",
  };
}

// ── Draw / UI System ──────────────────────────────────────────────────────────

@System(PlatformerBoard)
export class PlatformerUISystem extends DrawSystemImpl<ReadOnlyGameModel> {
  uiService: UIService;
  uiMap: UiMap;
  uiElements: UIElement[] = [];

  constructor(query: QueryInstance) {
    super(query);
    this.uiService = UIService.getInstance();
  }

  init = (gameModel: ReadOnlyGameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(PlatformerBoard, entity);
    const uiAsset = AssetLoader.getInstance().getUi(board.uiMap);
    this.uiMap = buildUiMap(uiAsset);

    const initialContext = formatContext(board);

    const eventHandler = (playerIndex: number, eventName: string, _eventType: string, _context: any) => {
      if (eventName === "onRestartClick") {
        const mutableGameModel = gameModel as any as GameModel;
        const mutableBoard = mutableGameModel.getTypedUnsafe(PlatformerBoard, entity);
        resetGame(mutableBoard);
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
    const board = gameModel.getTypedUnsafe(PlatformerBoard, entity);
    this.uiMap.update(formatContext(board));
  };

  cleanup = () => {
    if (this.uiElements.length) {
      this.uiService.removeFromUI(this.uiElements);
      this.uiElements = [];
    }
  };
}