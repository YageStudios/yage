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

  @type("string")
  @defaultValue("core/TetrisUI")
  uiMap: string;
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

// ── Format helpers ────────────────────────────────────────────────────────────

function formatContext(gameModel: ReadOnlyGameModel, board: TetrisBoard, boardId: number) {
  const cellEntities = gameModel.getComponentActives("TetrisCell");
  const cells = Array.from({ length: BOARD_COLS * BOARD_ROWS }, (_, i) => {
    const x = i % BOARD_COLS;
    const y = Math.floor(i / BOARD_COLS);

    for (const cellId of cellEntities) {
      const cell = gameModel.getTypedUnsafe(TetrisCell, cellId);
      if (cell.x === x && cell.y === y) {
        return { color: COLORS[cell.color] ?? COLORS[0] };
      }
    }
    return { color: COLORS[0] };
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
          if (cells[index].color === COLORS[0]) {
            cells[index] = { color: COLORS[8] };
          }
        }
      }
    }

    // Draw current piece
    const pieceGrid = getGridFromTetromino(tetromino, piece.rotation);
    for (const [row, col] of parseCellsFromGrid(pieceGrid, piece.x, piece.y)) {
      if (row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS) {
        cells[row * BOARD_COLS + col] = { color: COLORS[tetromino.colorIndex] };
      }
    }
  }

  // Next piece preview (4x4 grid) — read shape data from entity definition
  const nextShape = board.nextShape;
  const nextColorIndex = getDefinitionField(nextShape, "colorIndex") ?? 1;
  const nextGrid = getGridFromDefinition(nextShape, 0);
  const nextCells: { color: string }[] = Array.from({ length: 16 }, () => ({ color: COLORS[0] }));
  for (const [row, col] of parseCellsFromGrid(nextGrid, 0, 0)) {
    if (row >= 0 && row < 4 && col >= 0 && col < 4) {
      nextCells[row * 4 + col] = { color: COLORS[nextColorIndex] };
    }
  }

  return {
    cells,
    nextCells,
    score: board.score.toString(),
    level: board.level.toString(),
    lines: board.lines.toString(),
    showGameOver: board.status === "GAME_OVER",
  };
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

// ── Draw / UI System ──────────────────────────────────────────────────────────

@System(TetrisBoard)
export class TetrisUISystem extends DrawSystemImpl<ReadOnlyGameModel> {
  uiService: UIService;
  uiMap: UiMap;
  uiElements: UIElement[] = [];

  constructor(query: QueryInstance) {
    super(query);
    this.uiService = UIService.getInstance();
  }

  init = (gameModel: ReadOnlyGameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(TetrisBoard, entity);
    const uiAsset = AssetLoader.getInstance().getUi(board.uiMap);
    this.uiMap = buildUiMap(uiAsset);

    const initialContext = formatContext(gameModel, board, entity);

    const eventHandler = (playerIndex: number, eventName: string, _eventType: string, _context: any) => {
      if (eventName === "onRestartClick") {
        const mutableGameModel = gameModel as any as GameModel;
        const mutableBoard = mutableGameModel.getTypedUnsafe(TetrisBoard, entity);
        resetGame(mutableGameModel, mutableBoard, entity);
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
    const board = gameModel.getTypedUnsafe(TetrisBoard, entity);
    this.uiMap.update(formatContext(gameModel, board, entity));
  };

  cleanup = () => {
    if (this.uiElements.length) {
      this.uiService.removeFromUI(this.uiElements);
      this.uiElements = [];
    }
  };
}