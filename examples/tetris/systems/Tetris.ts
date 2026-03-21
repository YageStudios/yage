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

// ── Piece definitions (row, col offsets per rotation) ─────────────────────────

// Each piece: 4 rotations × 4 cells × [row, col]
const PIECES: number[][][][] = [
  // 0: I (cyan)
  [
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ],
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [0, 3],
    ],
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [3, 0],
    ],
  ],
  // 1: O (yellow)
  [
    [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
    [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
    [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
    [
      [0, 0],
      [0, 1],
      [1, 0],
      [1, 1],
    ],
  ],
  // 2: T (purple)
  [
    [
      [0, 1],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 0],
    ],
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 1],
    ],
    [
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
  ],
  // 3: S (green)
  [
    [
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
    ],
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
    [
      [0, 1],
      [0, 2],
      [1, 0],
      [1, 1],
    ],
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [2, 1],
    ],
  ],
  // 4: Z (red)
  [
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 2],
    ],
    [
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 0],
    ],
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [1, 2],
    ],
    [
      [0, 1],
      [1, 0],
      [1, 1],
      [2, 0],
    ],
  ],
  // 5: J (blue)
  [
    [
      [0, 0],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    [
      [0, 0],
      [0, 1],
      [1, 0],
      [2, 0],
    ],
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 2],
    ],
    [
      [0, 1],
      [1, 1],
      [2, 0],
      [2, 1],
    ],
  ],
  // 6: L (orange)
  [
    [
      [0, 2],
      [1, 0],
      [1, 1],
      [1, 2],
    ],
    [
      [0, 0],
      [1, 0],
      [2, 0],
      [2, 1],
    ],
    [
      [0, 0],
      [0, 1],
      [0, 2],
      [1, 0],
    ],
    [
      [0, 0],
      [0, 1],
      [1, 1],
      [2, 1],
    ],
  ],
];

// Spawn X offset per piece type (centers piece on 10-wide board)
const SPAWN_X = [3, 4, 3, 3, 3, 3, 3];

// Cell colors: 0=empty, 1=I, 2=O, 3=T, 4=S, 5=Z, 6=J, 7=L, 8=ghost
const COLORS = [
  "#111111", // empty
  "#00cfcf", // I cyan
  "#cfcf00", // O yellow
  "#9f00cf", // T purple
  "#00cf00", // S green
  "#cf0000", // Z red
  "#0000cf", // J blue
  "#cf6f00", // L orange
  "#2a2a2a", // ghost
];

// Auto-drop speed (frames per drop) by level
function getDropFrames(level: number): number {
  const frames = [48, 43, 38, 33, 28, 23, 18, 13, 8, 6, 5, 5, 5, 4, 4, 3, 3, 2, 2, 1];
  return frames[Math.min(level - 1, frames.length - 1)];
}

// ── Components ─────────────────────────────────────────────────────────────────

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
  pieceType: number;

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
  @type("number")
  @defaultValue(1)
  nextPieceType: number;

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

// ── Board helpers ─────────────────────────────────────────────────────────────

function getPieceCells(pieceType: number, rotation: number, x: number, y: number): [number, number][] {
  return PIECES[pieceType][rotation].map(([dr, dc]) => [y + dr, x + dc] as [number, number]);
}

function isValidPosition(
  gameModel: GameModel,
  boardId: number,
  pieceType: number,
  rotation: number,
  x: number,
  y: number,
): boolean {
  const cells = getPieceCells(pieceType, rotation, x, y);
  const cellEntities = gameModel.getComponentActives("TetrisCell");

  for (const [row, col] of cells) {
    if (row < 0) continue; // above board is ok during spawn
    if (row >= BOARD_ROWS || col < 0 || col >= BOARD_COLS) return false;

    // Check if cell is occupied
    for (const cellId of cellEntities) {
      const cell = gameModel.getTypedUnsafe(TetrisCell, cellId);
      if (cell.x === col && cell.y === row && cell.occupied) {
        return false;
      }
    }
  }
  return true;
}

function tryMovePiece(gameModel: GameModel, piece: TetrisPiece, dx: number, dy: number): boolean {
  if (isValidPosition(gameModel, piece.boardId, piece.pieceType, piece.rotation, piece.x + dx, piece.y + dy)) {
    piece.x += dx;
    piece.y += dy;
    return true;
  }
  return false;
}

function tryRotatePiece(gameModel: GameModel, piece: TetrisPiece, dir: number): void {
  const newRot = (piece.rotation + dir + 4) % 4;
  // Try base position first, then wall kicks
  const kicks: [number, number][] = [
    [0, 0],
    [1, 0],
    [-1, 0],
    [2, 0],
    [-2, 0],
    [0, -1],
    [1, -1],
    [-1, -1],
  ];
  for (const [dx, dy] of kicks) {
    if (isValidPosition(gameModel, piece.boardId, piece.pieceType, newRot, piece.x + dx, piece.y + dy)) {
      piece.x += dx;
      piece.y += dy;
      piece.rotation = newRot;
      return;
    }
  }
}

function getGhostY(gameModel: GameModel, piece: TetrisPiece): number {
  let ghostY = piece.y;
  while (isValidPosition(gameModel, piece.boardId, piece.pieceType, piece.rotation, piece.x, ghostY + 1)) {
    ghostY++;
  }
  return ghostY;
}

function lockPiece(gameModel: GameModel, piece: TetrisPiece, board: TetrisBoard): void {
  const cells = getPieceCells(piece.pieceType, piece.rotation, piece.x, piece.y);
  const cellEntities = gameModel.getComponentActives("TetrisCell");

  for (const [row, col] of cells) {
    if (row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS) {
      // Find the cell entity at this position and mark it occupied
      for (const cellId of cellEntities) {
        const cell = gameModel.getTypedUnsafe(TetrisCell, cellId);
        if (cell.x === col && cell.y === row) {
          cell.occupied = true;
          cell.color = piece.pieceType + 1;
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
    // Check if row is full
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
      // Clear this row
      for (const cellId of rowCells) {
        const cell = gameModel.getTypedUnsafe(TetrisCell, cellId);
        cell.occupied = false;
        cell.color = 0;
      }

      // Shift all rows above down
      for (let r = row; r > 0; r--) {
        const targetRowCells: number[] = [];
        const sourceRowCells: number[] = [];

        for (const cellId of cellEntities) {
          const cell = gameModel.getTypedUnsafe(TetrisCell, cellId);
          if (cell.y === r) {
            targetRowCells.push(cellId);
          }
          if (cell.y === r - 1) {
            sourceRowCells.push(cellId);
          }
        }

        // Copy colors and occupied status from row above
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

      // Clear top row
      for (const cellId of cellEntities) {
        const cell = gameModel.getTypedUnsafe(TetrisCell, cellId);
        if (cell.y === 0) {
          cell.occupied = false;
          cell.color = 0;
        }
      }

      row++; // Re-check same row position
    }
  }

  if (linesCleared > 0) {
    const scores = [0, 100, 300, 500, 800];
    board.score += scores[Math.min(linesCleared, 4)] * board.level;
    board.lines += linesCleared;
    board.level = Math.floor(board.lines / 10) + 1;
  }
}

function spawnNextPiece(gameModel: GameModel, board: TetrisBoard, boardId: number): boolean {
  const spawnX = SPAWN_X[board.nextPieceType];
  const spawnY = 0;

  if (!isValidPosition(gameModel, boardId, board.nextPieceType, 0, spawnX, spawnY)) {
    return false;
  }

  // Create the active piece entity
  const piece = EntityFactory.getInstance().generateEntity(gameModel, "TetrisPiece");
  const pieceData = gameModel.getTypedUnsafe(TetrisPiece, piece);
  pieceData.pieceType = board.nextPieceType;
  pieceData.x = spawnX;
  pieceData.y = spawnY;
  pieceData.rotation = 0;
  pieceData.boardId = boardId;
  pieceData.isGhost = false;

  board.nextPieceType = gameModel.rand.int(0, 6);
  return true;
}

function resetGame(gameModel: GameModel, board: TetrisBoard, boardId: number): void {
  // Clear all cells
  const cellEntities = gameModel.getComponentActives("TetrisCell");
  for (const cellId of cellEntities) {
    const cell = gameModel.getTypedUnsafe(TetrisCell, cellId);
    cell.occupied = false;
    cell.color = 0;
  }

  // Remove any existing pieces
  const pieceEntities = gameModel.getComponentActives("TetrisPiece");
  for (const pieceId of pieceEntities) {
    gameModel.removeEntity(pieceId);
  }

  // Reset board state
  const first = gameModel.rand.int(0, 6);
  const next = gameModel.rand.int(0, 6);

  board.nextPieceType = next;
  board.score = 0;
  board.level = 1;
  board.lines = 0;
  board.status = "PLAYING";
  board.tickTimer = 48;
  board.dasTimer = 0;
  board.dasDirection = 0;

  // Spawn first piece
  const piece = EntityFactory.getInstance().generateEntity(gameModel, "TetrisPiece");
  const pieceData = gameModel.getTypedUnsafe(TetrisPiece, piece);
  pieceData.pieceType = first;
  pieceData.x = SPAWN_X[first];
  pieceData.y = 0;
  pieceData.rotation = 0;
  pieceData.boardId = boardId;
  pieceData.isGhost = false;
}

function processInput(
  gameModel: GameModel,
  board: TetrisBoard,
  boardId: number,
  keyMap: Map<string, boolean>,
  prevKeyMap: Map<string, boolean> | undefined,
): void {
  const prev = prevKeyMap ?? new Map<string, boolean>();

  // Get the active piece (non-ghost piece)
  const pieceEntities = gameModel.getComponentActives("TetrisPiece");
  const activePiece = pieceEntities.find((id) => {
    const piece = gameModel.getTypedUnsafe(TetrisPiece, id);
    return !piece.isGhost && piece.boardId === boardId;
  });

  if (activePiece === undefined) return;
  const piece = gameModel.getTypedUnsafe(TetrisPiece, activePiece);

  // Rotate CW (up or e)
  if (keyPressed(["up", "e"], keyMap, prev)) {
    tryRotatePiece(gameModel, piece, 1);
  }
  // Rotate CCW (q)
  if (keyPressed(["q"], keyMap, prev)) {
    tryRotatePiece(gameModel, piece, -1);
  }

  // Horizontal DAS movement
  const movingLeft = keyDown(["left"], keyMap);
  const movingRight = keyDown(["right"], keyMap);
  const justLeft = keyPressed(["left"], keyMap, prev);
  const justRight = keyPressed(["right"], keyMap, prev);

  if (justLeft) {
    tryMovePiece(gameModel, piece, -1, 0);
    board.dasTimer = 0;
    board.dasDirection = -1;
  } else if (justRight) {
    tryMovePiece(gameModel, piece, 1, 0);
    board.dasTimer = 0;
    board.dasDirection = 1;
  }

  if ((movingLeft && board.dasDirection === -1) || (movingRight && board.dasDirection === 1)) {
    board.dasTimer++;
    if (board.dasTimer >= DAS_INITIAL && (board.dasTimer - DAS_INITIAL) % DAS_REPEAT === 0) {
      tryMovePiece(gameModel, piece, board.dasDirection, 0);
    }
  } else if (!movingLeft && !movingRight) {
    board.dasTimer = 0;
    board.dasDirection = 0;
  }

  // Soft drop
  if (keyDown(["down"], keyMap)) {
    if (tryMovePiece(gameModel, piece, 0, 1)) {
      board.tickTimer = getDropFrames(board.level);
    }
  }
}

// ── Format helpers ────────────────────────────────────────────────────────────

function formatContext(gameModel: GameModel, board: TetrisBoard, boardId: number) {
  const cellEntities = gameModel.getComponentActives("TetrisCell");
  const cells = Array.from({ length: BOARD_COLS * BOARD_ROWS }, (_, i) => {
    const x = i % BOARD_COLS;
    const y = Math.floor(i / BOARD_COLS);

    // Find cell entity at this position
    for (const cellId of cellEntities) {
      const cell = gameModel.getTypedUnsafe(TetrisCell, cellId);
      if (cell.x === x && cell.y === y) {
        return { color: COLORS[cell.color] ?? COLORS[0] };
      }
    }
    return { color: COLORS[0] };
  });

  // Get active piece
  const pieceEntities = gameModel.getComponentActives("TetrisPiece");
  const activePiece = pieceEntities.find((id) => {
    const piece = gameModel.getTypedUnsafe(TetrisPiece, id);
    return !piece.isGhost && piece.boardId === boardId;
  });

  if (activePiece !== undefined) {
    const piece = gameModel.getTypedUnsafe(TetrisPiece, activePiece);

    // Draw ghost piece
    const ghostY = getGhostY(gameModel, piece);
    if (ghostY !== piece.y) {
      for (const [row, col] of getPieceCells(piece.pieceType, piece.rotation, piece.x, ghostY)) {
        if (row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS) {
          const index = row * BOARD_COLS + col;
          if (cells[index].color === COLORS[0]) {
            cells[index] = { color: COLORS[8] };
          }
        }
      }
    }

    // Draw current piece
    for (const [row, col] of getPieceCells(piece.pieceType, piece.rotation, piece.x, piece.y)) {
      if (row >= 0 && row < BOARD_ROWS && col >= 0 && col < BOARD_COLS) {
        cells[row * BOARD_COLS + col] = { color: COLORS[piece.pieceType + 1] };
      }
    }
  }

  // Next piece preview (4x4 grid)
  const nextCells: { color: string }[] = Array.from({ length: 16 }, () => ({ color: COLORS[0] }));
  for (const [row, col] of getPieceCells(board.nextPieceType, 0, 0, 0)) {
    if (row >= 0 && row < 4 && col >= 0 && col < 4) {
      nextCells[row * 4 + col] = { color: COLORS[board.nextPieceType + 1] };
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
  static depth = -100; // Run early

  init = (gameModel: GameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(TetrisBoard, entity);

    // Create cell entities for the entire board
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

    // Initialize the game
    const first = gameModel.rand.int(0, 6);
    const next = gameModel.rand.int(0, 6);

    board.nextPieceType = next;
    board.score = 0;
    board.level = 1;
    board.lines = 0;
    board.status = "PLAYING";
    board.tickTimer = 48;
    board.dasTimer = 0;
    board.dasDirection = 0;

    // Spawn first piece
    const piece = EntityFactory.getInstance().generateEntity(gameModel, "TetrisPiece");
    const pieceData = gameModel.getTypedUnsafe(TetrisPiece, piece);
    pieceData.pieceType = first;
    pieceData.x = SPAWN_X[first];
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

    // Process player input
    const playerEntities = gameModel.getComponentActives("PlayerInput");
    let playerInput: PlayerInput | null = null;
    if (playerEntities.length > 0) {
      playerInput = gameModel.getTypedUnsafe(PlayerInput, playerEntities[0]);
      if (playerInput.keyMap) {
        processInput(gameModel, board, entity, playerInput.keyMap, playerInput.prevKeyMap);
      }
    }

    if (board.status !== "PLAYING") return;

    // Get the active piece
    const pieceEntities = gameModel.getComponentActives("TetrisPiece");
    const activePiece = pieceEntities.find((id) => {
      const piece = gameModel.getTypedUnsafe(TetrisPiece, id);
      return !piece.isGhost && piece.boardId === entity;
    });

    if (activePiece === undefined) return;
    const piece = gameModel.getTypedUnsafe(TetrisPiece, activePiece);

    // Hard drop
    if (playerInput?.keyMap && keyPressed(["space"], playerInput.keyMap, playerInput.prevKeyMap ?? new Map())) {
      const ghostY = getGhostY(gameModel, piece);
      const dropDistance = ghostY - piece.y;
      board.score += dropDistance * 2;
      piece.y = ghostY;
      lockPiece(gameModel, piece, board);
      gameModel.removeEntity(activePiece);
      if (!spawnNextPiece(gameModel, board, entity)) {
        board.status = "GAME_OVER";
      }
      board.tickTimer = getDropFrames(board.level);
      return;
    }

    // Auto-drop tick
    board.tickTimer--;
    if (board.tickTimer <= 0) {
      if (!tryMovePiece(gameModel, piece, 0, 1)) {
        lockPiece(gameModel, piece, board);
        gameModel.removeEntity(activePiece);
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