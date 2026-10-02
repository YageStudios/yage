import { Component, defaultValue, DrawSystemImpl, Schema, System, SystemImpl, type } from "minecs";
import type { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import { Button, Column, CommandQueue, Grid, Model, Panel, Text, UIFinal, each, when } from "yage/ui/final";
import type { Child } from "yage/ui/final";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { keyDown, keyPressed } from "yage/utils/keys";
import { EntityFactory } from "yage/entity/EntityFactory";
import { canPresentUI } from "../../shared/uiFinal";

// ── Constants ─────────────────────────────────────────────────────────────────

const BOARD_COLS = 10;
const BOARD_ROWS = 20;
const DAS_INITIAL = 16;
const DAS_REPEAT = 6;

const SHAPE_NAMES = ["I", "O", "T", "S", "Z", "J", "L"] as const;
type ShapeName = (typeof SHAPE_NAMES)[number];

// Cell colors: 0=empty, 1-7=tetromino colors, 8=ghost
const COLORS = [
  "#111111", // 0 empty
  "#00cfcf", // 1 I cyan
  "#cfcf00", // 2 O yellow
  "#9f00cf", // 3 T purple
  "#00cf00", // 4 S green
  "#cf0000", // 5 Z red
  "#0000cf", // 6 J blue
  "#cf6f00", // 7 L orange
  "#2a2a2a", // 8 ghost
];

function getDropFrames(level: number): number {
  const frames = [48, 43, 38, 33, 28, 23, 18, 13, 8, 6, 5, 5, 5, 4, 4, 3, 3, 2, 2, 1];
  return frames[Math.min(level - 1, frames.length - 1)];
}

// ── Components ─────────────────────────────────────────────────────────────────

@Component()
export class Tetromino extends Schema {
  @type("string")
  @defaultValue("I")
  shape: string;

  @type("number")
  @defaultValue(1)
  colorIndex: number;

  @type("number")
  @defaultValue(3)
  spawnX: number;

  // 4x4 binary grid (16-char string of 0/1, row-major) — rotations are computed
  @type("string")
  @defaultValue("0000000000000000")
  grid: string;
}

@Component()
export class TetrisCell extends Schema {
  @type("number")
  @defaultValue(0)
  x: number;

  @type("number")
  @defaultValue(0)
  y: number;

  @type("boolean")
  @defaultValue(false)
  occupied: boolean;

  @type("number")
  @defaultValue(0)
  color: number;
}

@Component()
export class TetrisPiece extends Schema {
  @type("number")
  @defaultValue(0)
  rotation: number;

  @type("number")
  @defaultValue(0)
  x: number;

  @type("number")
  @defaultValue(0)
  y: number;

  @type("boolean")
  @defaultValue(false)
  isGhost: boolean;

  @type("number")
  @defaultValue(0)
  boardId: number;
}

@Component()
export class TetrisBoard extends Schema {
  @type("string")
  @defaultValue("I")
  nextShape: string;

  @type("number")
  @defaultValue(0)
  score: number;

  @type("number")
  @defaultValue(1)
  level: number;

  @type("number")
  @defaultValue(0)
  lines: number;

  @type("string")
  @defaultValue("PLAYING")
  status: string;

  @type("number")
  @defaultValue(48)
  tickTimer: number;

  @type("number")
  @defaultValue(0)
  dasTimer: number;

  @type("number")
  @defaultValue(0)
  dasDirection: number;
}

// ── Grid helpers ──────────────────────────────────────────────────────────────

function parseCellsFromGrid(grid: string, x: number, y: number): [number, number][] {
  const cells: [number, number][] = [];
  for (let i = 0; i < 16; i++) {
    if (grid[i] === "1") {
      const row = Math.floor(i / 4);
      const col = i % 4;
      cells.push([y + row, x + col]);
    }
  }
  return cells;
}

function rotateGrid90(grid: string): string {
  const out = new Array(16);
  for (let r = 0; r < 4; r++) {
    for (let c = 0; c < 4; c++) {
      out[c * 4 + (3 - r)] = grid[r * 4 + c];
    }
  }
  return out.join("");
}

function getRotatedGrid(baseGrid: string, rotation: number): string {
  let grid = baseGrid;
  for (let i = 0; i < (rotation % 4); i++) {
    grid = rotateGrid90(grid);
  }
  return grid;
}

function getGridFromTetromino(tetromino: Tetromino, rotation: number): string {
  return getRotatedGrid(tetromino.grid, rotation);
}

function entityNameForShape(shape: string): string {
  return `Tetromino_${shape}`;
}

function getGridFromDefinition(shape: string, rotation: number): string {
  const entityName = entityNameForShape(shape);
  const def = EntityFactory.getInstance().getComponentFromEntity(entityName, "Tetromino");
  const baseGrid = def?.grid ?? "0000000000000000";
  return getRotatedGrid(baseGrid, rotation);
}

function getDefinitionField(shape: string, field: string): any {
  const entityName = entityNameForShape(shape);
  const def = EntityFactory.getInstance().getComponentFromEntity(entityName, "Tetromino");
  return def?.[field];
}

// ── Board helpers ─────────────────────────────────────────────────────────────

function isValidPositionByGrid(
  gameModel: GameModel,
  grid: string,
  x: number,
  y: number,
): boolean {
  const cells = parseCellsFromGrid(grid, x, y);
  const cellEntities = gameModel.getComponentActives("TetrisCell");

  for (const [row, col] of cells) {
    if (row < 0) continue;
    if (row >= BOARD_ROWS || col < 0 || col >= BOARD_COLS) return false;

    for (const cellId of cellEntities) {
      const cell = gameModel.getTypedUnsafe(TetrisCell, cellId);
      if (cell.x === col && cell.y === row && cell.occupied) {
        return false;
      }
    }
  }
  return true;
}

function tryMovePiece(gameModel: GameModel, piece: TetrisPiece, tetromino: Tetromino, dx: number, dy: number): boolean {
  const grid = getGridFromTetromino(tetromino, piece.rotation);
  if (isValidPositionByGrid(gameModel, grid, piece.x + dx, piece.y + dy)) {
    piece.x += dx;
    piece.y += dy;
    return true;
  }
  return false;
}

function tryRotatePiece(gameModel: GameModel, piece: TetrisPiece, tetromino: Tetromino, dir: number): void {
  const newRot = (piece.rotation + dir + 4) % 4;
  const grid = getGridFromTetromino(tetromino, newRot);
  const kicks: [number, number][] = [
    [0, 0], [1, 0], [-1, 0], [2, 0], [-2, 0], [0, -1], [1, -1], [-1, -1],
  ];
  for (const [dx, dy] of kicks) {
    if (isValidPositionByGrid(gameModel, grid, piece.x + dx, piece.y + dy)) {
      piece.x += dx;
      piece.y += dy;
      piece.rotation = newRot;
      return;
    }
  }
}

function getGhostY(gameModel: GameModel, piece: TetrisPiece, tetromino: Tetromino): number {
  const grid = getGridFromTetromino(tetromino, piece.rotation);
  let ghostY = piece.y;
  while (isValidPositionByGrid(gameModel, grid, piece.x, ghostY + 1)) {
    ghostY++;
  }
  return ghostY;
}

function lockPiece(gameModel: GameModel, piece: TetrisPiece, tetromino: Tetromino, board: TetrisBoard): void {
  const grid = getGridFromTetromino(tetromino, piece.rotation);
  const cells = parseCellsFromGrid(grid, piece.x, piece.y);
  const cellEntities = gameModel.getComponentActives("TetrisCell");

  for (const [row, col] of cells) {
    if (row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS) {
      for (const cellId of cellEntities) {
        const cell = gameModel.getTypedUnsafe(TetrisCell, cellId);
        if (cell.x === col && cell.y === row) {
          cell.occupied = true;
          cell.color = tetromino.colorIndex;
          break;
        }
      }
    }
  }
  clearLines(gameModel, board);
}

function clearLines(gameModel: GameModel, board: TetrisBoard): void {
  const cellEntities = gameModel.getComponentActives("TetrisCell");
  let linesCleared = 0;

  for (let row = BOARD_ROWS - 1; row >= 0; row--) {
    let cellsInRow = 0;
    const rowCells: number[] = [];

    for (const cellId of cellEntities) {
      const cell = gameModel.getTypedUnsafe(TetrisCell, cellId);
      if (cell.y === row && cell.occupied) {
        cellsInRow++;
        rowCells.push(cellId);
      }
    }

    if (cellsInRow === BOARD_COLS) {
      linesCleared++;
      for (const cellId of rowCells) {
        const cell = gameModel.getTypedUnsafe(TetrisCell, cellId);
        cell.occupied = false;
        cell.color = 0;
      }

      for (let r = row; r > 0; r--) {
        const targetRowCells: number[] = [];
        const sourceRowCells: number[] = [];

        for (const cellId of cellEntities) {
          const cell = gameModel.getTypedUnsafe(TetrisCell, cellId);
          if (cell.y === r) targetRowCells.push(cellId);
          if (cell.y === r - 1) sourceRowCells.push(cellId);
        }

        for (const targetId of targetRowCells) {
          const targetCell = gameModel.getTypedUnsafe(TetrisCell, targetId);
          const sourceId = sourceRowCells.find((id) => {
            const sourceCell = gameModel.getTypedUnsafe(TetrisCell, id);
            return sourceCell.x === targetCell.x;
          });
          if (sourceId !== undefined) {
            const sourceCell = gameModel.getTypedUnsafe(TetrisCell, sourceId);
            targetCell.occupied = sourceCell.occupied;
            targetCell.color = sourceCell.color;
          }
        }
      }

      for (const cellId of cellEntities) {
        const cell = gameModel.getTypedUnsafe(TetrisCell, cellId);
        if (cell.y === 0) {
          cell.occupied = false;
          cell.color = 0;
        }
      }

      row++;
    }
  }

  if (linesCleared > 0) {
    const scores = [0, 100, 300, 500, 800];
    board.score += scores[Math.min(linesCleared, 4)] * board.level;
    board.lines += linesCleared;
    board.level = Math.floor(board.lines / 10) + 1;
  }
}

function randomShape(gameModel: GameModel): ShapeName {
  return SHAPE_NAMES[gameModel.rand.int(0, SHAPE_NAMES.length - 1)];
}

function spawnNextPiece(gameModel: GameModel, board: TetrisBoard, boardId: number): boolean {
  const shapeName = board.nextShape;
  const spawnX = getDefinitionField(shapeName, "spawnX") ?? 3;
  const grid = getGridFromDefinition(shapeName, 0);

  if (!isValidPositionByGrid(gameModel, grid, spawnX, 0)) {
    return false;
  }

  const entityName = entityNameForShape(shapeName);
  const pieceId = EntityFactory.getInstance().generateEntity(gameModel, entityName);
  const piece = gameModel.getTypedUnsafe(TetrisPiece, pieceId);
  piece.x = spawnX;
  piece.y = 0;
  piece.rotation = 0;
  piece.boardId = boardId;
  piece.isGhost = false;

  board.nextShape = randomShape(gameModel);
  return true;
}

function findActivePiece(gameModel: GameModel, boardId: number): number | undefined {
  const pieceEntities = gameModel.getComponentActives("TetrisPiece");
  return pieceEntities.find((id) => {
    const piece = gameModel.getTypedUnsafe(TetrisPiece, id);
    return !piece.isGhost && piece.boardId === boardId;
  });
}

function resetGame(gameModel: GameModel, board: TetrisBoard, boardId: number): void {
  const cellEntities = gameModel.getComponentActives("TetrisCell");
  for (const cellId of cellEntities) {
    const cell = gameModel.getTypedUnsafe(TetrisCell, cellId);
    cell.occupied = false;
    cell.color = 0;
  }

  const pieceEntities = gameModel.getComponentActives("TetrisPiece");
  for (const pieceId of pieceEntities) {
    gameModel.removeEntity(pieceId);
  }

  const firstShape = randomShape(gameModel);
  const nextShape = randomShape(gameModel);

  board.nextShape = nextShape;
  board.score = 0;
  board.level = 1;
  board.lines = 0;
  board.status = "PLAYING";
  board.tickTimer = 48;
  board.dasTimer = 0;
  board.dasDirection = 0;

  const entityName = entityNameForShape(firstShape);
  const spawnX = getDefinitionField(firstShape, "spawnX") ?? 3;

  const pieceId = EntityFactory.getInstance().generateEntity(gameModel, entityName);
  const piece = gameModel.getTypedUnsafe(TetrisPiece, pieceId);
  piece.x = spawnX;
  piece.y = 0;
  piece.rotation = 0;
  piece.boardId = boardId;
  piece.isGhost = false;
}

function processInput(
  gameModel: GameModel,
  board: TetrisBoard,
  boardId: number,
  keyMap: Map<string, boolean>,
  prevKeyMap: Map<string, boolean> | undefined,
): void {
  const prev = prevKeyMap ?? new Map<string, boolean>();

  const activePieceId = findActivePiece(gameModel, boardId);
  if (activePieceId === undefined) return;

  const piece = gameModel.getTypedUnsafe(TetrisPiece, activePieceId);
  const tetromino = gameModel.getTypedUnsafe(Tetromino, activePieceId);

  if (keyPressed(["up", "e"], keyMap, prev)) {
    tryRotatePiece(gameModel, piece, tetromino, 1);
  }
  if (keyPressed(["q"], keyMap, prev)) {
    tryRotatePiece(gameModel, piece, tetromino, -1);
  }

  const movingLeft = keyDown(["left"], keyMap);
  const movingRight = keyDown(["right"], keyMap);
  const justLeft = keyPressed(["left"], keyMap, prev);
  const justRight = keyPressed(["right"], keyMap, prev);

  if (justLeft) {
    tryMovePiece(gameModel, piece, tetromino, -1, 0);
    board.dasTimer = 0;
    board.dasDirection = -1;
  } else if (justRight) {
    tryMovePiece(gameModel, piece, tetromino, 1, 0);
    board.dasTimer = 0;
    board.dasDirection = 1;
  }

  if ((movingLeft && board.dasDirection === -1) || (movingRight && board.dasDirection === 1)) {
    board.dasTimer++;
    if (board.dasTimer >= DAS_INITIAL && (board.dasTimer - DAS_INITIAL) % DAS_REPEAT === 0) {
      tryMovePiece(gameModel, piece, tetromino, board.dasDirection, 0);
    }
  } else if (!movingLeft && !movingRight) {
    board.dasTimer = 0;
    board.dasDirection = 0;
  }

  if (keyDown(["down"], keyMap)) {
    if (tryMovePiece(gameModel, piece, tetromino, 0, 1)) {
      board.tickTimer = getDropFrames(board.level);
    }
  }
}

// ── Presentation projection ───────────────────────────────────────────────────

function boardCells(gameModel: ReadOnlyGameModel, board: TetrisBoard, boardId: number): string[] {
  const cellEntities = gameModel.getComponentActives("TetrisCell");
  const cells = Array.from({ length: BOARD_COLS * BOARD_ROWS }, (_, i) => {
    const x = i % BOARD_COLS;
    const y = Math.floor(i / BOARD_COLS);

    for (const cellId of cellEntities) {
      const cell = gameModel.getTypedUnsafe(TetrisCell, cellId);
      if (cell.x === x && cell.y === y) {
        return COLORS[cell.color] ?? COLORS[0];
      }
    }
    return COLORS[0];
  });

  const activePieceId = findActivePiece(gameModel as GameModel, boardId);

  if (activePieceId !== undefined) {
    const piece = gameModel.getTypedUnsafe(TetrisPiece, activePieceId);
    const tetromino = gameModel.getTypedUnsafe(Tetromino, activePieceId);

    // Draw ghost piece
    const ghostY = getGhostY(gameModel as GameModel, piece, tetromino);
    if (ghostY !== piece.y) {
      const ghostGrid = getGridFromTetromino(tetromino, piece.rotation);
      for (const [row, col] of parseCellsFromGrid(ghostGrid, piece.x, ghostY)) {
        if (row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS) {
          const index = row * BOARD_COLS + col;
          if (cells[index] === COLORS[0]) {
            cells[index] = COLORS[8];
          }
        }
      }
    }

    // Draw current piece
    const pieceGrid = getGridFromTetromino(tetromino, piece.rotation);
    for (const [row, col] of parseCellsFromGrid(pieceGrid, piece.x, piece.y)) {
      if (row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS) {
        cells[row * BOARD_COLS + col] = COLORS[tetromino.colorIndex];
      }
    }
  }
  return cells;
}

function nextPieceCells(board: TetrisBoard): string[] {
  const nextColorIndex = getDefinitionField(board.nextShape, "colorIndex") ?? 1;
  const nextGrid = getGridFromDefinition(board.nextShape, 0);
  const cells: string[] = Array.from({ length: 16 }, () => COLORS[0]);
  for (const [row, col] of parseCellsFromGrid(nextGrid, 0, 0)) {
    if (row >= 0 && row < 4 && col >= 0 && col < 4) {
      cells[row * 4 + col] = COLORS[nextColorIndex];
    }
  }
  return cells;
}

interface TetrisHudState {
  score: string;
  level: string;
  lines: string;
  cells: string[];
  nextCells: string[];
  showGameOver: boolean;
}

// ── Initialization System ────────────────────────────────────────────────────

@System(TetrisBoard)
export class TetrisInitSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = -100;

  init = (gameModel: GameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(TetrisBoard, entity);

    for (let y = 0; y < BOARD_ROWS; y++) {
      for (let x = 0; x < BOARD_COLS; x++) {
        const cell = EntityFactory.getInstance().generateEntity(gameModel, "TetrisCell");
        const cellData = gameModel.getTypedUnsafe(TetrisCell, cell);
        cellData.x = x;
        cellData.y = y;
        cellData.occupied = false;
        cellData.color = 0;
      }
    }

    const firstShape = randomShape(gameModel);
    const nextShape = randomShape(gameModel);

    board.nextShape = nextShape;
    board.score = 0;
    board.level = 1;
    board.lines = 0;
    board.status = "PLAYING";
    board.tickTimer = 48;
    board.dasTimer = 0;
    board.dasDirection = 0;

    const entityName = entityNameForShape(firstShape);
    const spawnX = getDefinitionField(firstShape, "spawnX") ?? 3;

    const pieceId = EntityFactory.getInstance().generateEntity(gameModel, entityName);
    const pieceData = gameModel.getTypedUnsafe(TetrisPiece, pieceId);
    pieceData.x = spawnX;
    pieceData.y = 0;
    pieceData.rotation = 0;
    pieceData.boardId = entity;
    pieceData.isGhost = false;
  };
}

// ── Game Logic System ─────────────────────────────────────────────────────────

@System(TetrisBoard)
export class TetrisSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = 0;

  run = (gameModel: GameModel, entity: number) => {
    // HUD restart commands are applied here — the authoritative gameplay input point.
    gameModel.getSystem(TetrisUISystem)?.commands.drain(command => {
      if (command.type !== "restart") return;
      resetGame(gameModel, gameModel.getTypedUnsafe(TetrisBoard, entity), entity);
    });

    const board = gameModel.getTypedUnsafe(TetrisBoard, entity);
    if (board.status !== "PLAYING") return;

    const playerEntities = gameModel.getComponentActives("PlayerInput");
    let playerInput: PlayerInput | null = null;
    if (playerEntities.length > 0) {
      playerInput = gameModel.getTypedUnsafe(PlayerInput, playerEntities[0]);
      if (playerInput.keyMap) {
        processInput(gameModel, board, entity, playerInput.keyMap, playerInput.prevKeyMap);
      }
    }

    if (board.status !== "PLAYING") return;

    const activePieceId = findActivePiece(gameModel, entity);
    if (activePieceId === undefined) return;

    const piece = gameModel.getTypedUnsafe(TetrisPiece, activePieceId);
    const tetromino = gameModel.getTypedUnsafe(Tetromino, activePieceId);

    // Hard drop
    if (playerInput?.keyMap && keyPressed(["space"], playerInput.keyMap, playerInput.prevKeyMap ?? new Map())) {
      const ghostY = getGhostY(gameModel, piece, tetromino);
      const dropDistance = ghostY - piece.y;
      board.score += dropDistance * 2;
      piece.y = ghostY;
      lockPiece(gameModel, piece, tetromino, board);
      gameModel.removeEntity(activePieceId);
      if (!spawnNextPiece(gameModel, board, entity)) {
        board.status = "GAME_OVER";
      }
      board.tickTimer = getDropFrames(board.level);
      return;
    }

    // Auto-drop tick
    board.tickTimer--;
    if (board.tickTimer <= 0) {
      if (!tryMovePiece(gameModel, piece, tetromino, 0, 1)) {
        lockPiece(gameModel, piece, tetromino, board);
        gameModel.removeEntity(activePieceId);
        if (!spawnNextPiece(gameModel, board, entity)) {
          board.status = "GAME_OVER";
        }
      }
      board.tickTimer = getDropFrames(board.level);
    }
  };
}

// ── UI Final HUD ──────────────────────────────────────────────────────────────

@System(TetrisBoard)
export class TetrisUISystem extends DrawSystemImpl<ReadOnlyGameModel> {
  /** Commands from the HUD; drained by TetrisSystem at the gameplay input boundary. */
  readonly commands = new CommandQueue();
  private ui?: UIFinal;
  private state?: Model<TetrisHudState>;

  init = (_gameModel: ReadOnlyGameModel, _entity: number) => {
    // Headless runs (unit tests) have no real DOM; the HUD is presentation-only.
    if (!canPresentUI() || this.ui) return;
    const ui = (this.ui = new UIFinal());
    const state = (this.state = new Model<TetrisHudState>({
      score: "0", level: "1", lines: "0",
      cells: Array.from({ length: BOARD_COLS * BOARD_ROWS }, () => COLORS[0]),
      nextCells: Array.from({ length: 16 }, () => COLORS[0]),
      showGameOver: false,
    }));
    ui.scope.add(() => { this.state = undefined; state.dispose(); });
    ui.mount(this.hud(state));
  };

  private cellGrid(state: Model<TetrisHudState>, id: string, path: "cells" | "nextCells", columns: number, size: number): Child {
    return Grid({
      id,
      style: {
        gridTemplateColumns: `repeat(${columns}, ${size}px)`, gap: 1, padding: 1,
        backgroundColor: path === "cells" ? "#222222" : "#1a1a1a", borderRadius: 4,
      },
    }, each(state.select<readonly string[]>(path), (_, index) => index, color =>
      Panel({ style: { width: size, height: size, borderRadius: 2, background: () => color.get() } })));
  }

  private hud(state: Model<TetrisHudState>): Child {
    const stat = (label: string, path: "score" | "level" | "lines"): Child =>
      Column({ style: { gap: 8, alignItems: "center" } },
        Text(label, { style: { fontSize: 18, color: "#aaaaaa" } }),
        Text(() => state.get<string>(path), { style: { fontSize: 26, color: "#ffffff", fontWeight: "bold" } }));

    return [
      Panel({
        id: "mainContent",
        style: {
          position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
          display: "flex", alignItems: "center", gap: 40,
        },
      },
        this.cellGrid(state, "boardGrid", "cells", BOARD_COLS, 26),
        Column({ id: "sidePanel", style: { gap: 34 } },
          stat("SCORE", "score"),
          stat("LEVEL", "level"),
          stat("LINES", "lines"),
          Column({ style: { gap: 12, alignItems: "center" } },
            Text("NEXT", { style: { fontSize: 18, color: "#aaaaaa" } }),
            this.cellGrid(state, "nextGrid", "nextCells", 4, 26)))),
      Text("← → move  ↑ rotate  ↓ soft drop  space hard drop", {
        style: {
          position: "absolute", bottom: 30, left: "50%", transform: "translateX(-50%)",
          fontSize: 14, color: "#888888", textAlign: "center",
        },
      }),
      when(() => state.get<boolean>("showGameOver"), () =>
        Panel({
          id: "gameOver",
          style: { position: "absolute", inset: 0, display: "grid", placeItems: "center" },
        },
          Column({ style: { alignItems: "center", gap: 24 } },
            Text("GAME OVER", {
              id: "gameOverText",
              style: {
                fontSize: 56, color: "#ff4444", textAlign: "center",
                textShadow: "0 0 20px #ff0000",
              },
            }),
            Button({
              id: "restart",
              autoFocus: true,
              style: {
                minWidth: 220, minHeight: 64, fontSize: 28,
                backgroundColor: "#4444CC", color: "#ffffff", borderRadius: 8,
              },
              on: { activate: event => { this.commands.enqueue(event.player, "restart"); } },
            }, "Play Again")))),
    ];
  }

  run = (gameModel: ReadOnlyGameModel, entity: number) => {
    if (!this.state) return;
    const board = gameModel.getTypedUnsafe(TetrisBoard, entity);
    this.state.set("score", board.score.toString());
    this.state.set("level", board.level.toString());
    this.state.set("lines", board.lines.toString());
    this.state.set("cells", boardCells(gameModel, board, entity));
    this.state.set("nextCells", nextPieceCells(board));
    this.state.set("showGameOver", board.status === "GAME_OVER");
  };

  cleanup = () => {
    this.ui?.dispose();
    this.ui = undefined;
  };
}