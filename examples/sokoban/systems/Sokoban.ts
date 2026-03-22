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

// Cell types: # = wall, . = floor, @ = player, $ = box, * = box on target, + = player on target, (space) = target
const LEVELS: string[][] = [
  ["########", "#......#", "#.@.$.##", "#..$.#.#", "## ..O.#", "#..O.$.#", "#...$..#", "########"],
  ["##########", "#........#", "#..@..$..#", "#..$.##..#", "#...O.O..#", "#..$.....#", "#........#", "##########"],
  ["##########", "#..#.....#", "#..$.@...#", "#..#..$..#", "#..O..O..#", "#..#..$..#", "#....O...#", "##########"],
  [
    "############",
    "#..........#",
    "#.@.$$.$...#",
    "#..........#",
    "##.#OOO#.###",
    "#..........#",
    "#....$.....#",
    "#..........#",
    "############",
  ],
];

// Symbols: # = wall, . = floor, @ = player start, $ = box, O = target (goal)

// ── Component ─────────────────────────────────────────────────────────────────

@Component()
export class SokobanBoard extends Schema {
  @type("string")
  @defaultValue("PLAYING")
  status: string;

  @type("number")
  @defaultValue(0)
  moves: number;

  @type("number")
  @defaultValue(0)
  currentLevel: number;

  @type("number")
  @defaultValue(0)
  playerX: number;

  @type("number")
  @defaultValue(0)
  playerY: number;

  @type("number")
  @defaultValue(0)
  levelWidth: number;

  @type("number")
  @defaultValue(0)
  levelHeight: number;

  // Wall map (flat boolean array): 1 = wall, 0 = floor
  @type(["number"])
  @defaultValue([])
  walls: number[];

  // Target positions (flat boolean array): 1 = target, 0 = not
  @type(["number"])
  @defaultValue([])
  targets: number[];

  // Box positions (flat boolean array): 1 = box, 0 = not
  @type(["number"])
  @defaultValue([])
  boxes: number[];

  // Undo stack: each entry is [playerX, playerY, ...boxPositions]
  @type(["number"])
  @defaultValue([])
  undoStack: number[];

  @type("number")
  @defaultValue(0)
  undoStackSize: number;

  @type("string")
  @defaultValue("SokobanUI")
  uiMap: string;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function loadLevel(board: SokobanBoard, levelIndex: number): void {
  const level = LEVELS[levelIndex % LEVELS.length];
  const height = level.length;
  const width = level[0].length;

  board.levelWidth = width;
  board.levelHeight = height;
  board.moves = 0;
  board.status = "PLAYING";
  board.undoStack = [];
  board.undoStackSize = 0;

  const walls: number[] = [];
  const targets: number[] = [];
  const boxes: number[] = [];

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const ch = level[y][x] || ".";
      walls.push(ch === "#" ? 1 : 0);
      targets.push(ch === "O" || ch === "+" || ch === "*" ? 1 : 0);
      boxes.push(ch === "$" || ch === "*" ? 1 : 0);

      if (ch === "@" || ch === "+") {
        board.playerX = x;
        board.playerY = y;
      }
    }
  }

  board.walls = walls;
  board.targets = targets;
  board.boxes = boxes;
}

function getIdx(board: SokobanBoard, x: number, y: number): number {
  return y * board.levelWidth + x;
}

function isWall(board: SokobanBoard, x: number, y: number): boolean {
  if (x < 0 || x >= board.levelWidth || y < 0 || y >= board.levelHeight) return true;
  return board.walls[getIdx(board, x, y)] === 1;
}

function isBox(board: SokobanBoard, x: number, y: number): boolean {
  if (x < 0 || x >= board.levelWidth || y < 0 || y >= board.levelHeight) return false;
  return board.boxes[getIdx(board, x, y)] === 1;
}

function saveUndo(board: SokobanBoard): void {
  const state = [board.playerX, board.playerY, ...board.boxes];
  // Append to undo stack
  board.undoStack = [...board.undoStack, ...state];
  board.undoStackSize++;
}

function popUndo(board: SokobanBoard): boolean {
  if (board.undoStackSize === 0) return false;
  const stateSize = 2 + board.boxes.length;
  const startIdx = (board.undoStackSize - 1) * stateSize;
  board.playerX = board.undoStack[startIdx];
  board.playerY = board.undoStack[startIdx + 1];
  board.boxes = board.undoStack.slice(startIdx + 2, startIdx + 2 + board.boxes.length);
  board.undoStack = board.undoStack.slice(0, startIdx);
  board.undoStackSize--;
  board.moves = Math.max(0, board.moves - 1);
  return true;
}

function tryMove(board: SokobanBoard, dx: number, dy: number): boolean {
  const newX = board.playerX + dx;
  const newY = board.playerY + dy;

  if (isWall(board, newX, newY)) return false;

  if (isBox(board, newX, newY)) {
    // Check if box can be pushed
    const boxNewX = newX + dx;
    const boxNewY = newY + dy;
    if (isWall(board, boxNewX, boxNewY) || isBox(board, boxNewX, boxNewY)) {
      return false;
    }

    // Save state for undo
    saveUndo(board);

    // Push box
    board.boxes[getIdx(board, newX, newY)] = 0;
    board.boxes[getIdx(board, boxNewX, boxNewY)] = 1;
  } else {
    saveUndo(board);
  }

  board.playerX = newX;
  board.playerY = newY;
  board.moves++;

  return true;
}

function checkWin(board: SokobanBoard): boolean {
  for (let i = 0; i < board.targets.length; i++) {
    if (board.targets[i] === 1 && board.boxes[i] !== 1) {
      return false;
    }
  }
  return true;
}

// ── Init System ───────────────────────────────────────────────────────────────

@System(SokobanBoard)
export class SokobanInitSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = -100;

  init = (_gameModel: GameModel, entity: number) => {
    const board = _gameModel.getTypedUnsafe(SokobanBoard, entity);
    loadLevel(board, board.currentLevel);
  };
}

// ── Game Logic System ─────────────────────────────────────────────────────────

@System(SokobanBoard)
export class SokobanSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = 0;

  run = (gameModel: GameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(SokobanBoard, entity);
    if (board.status !== "PLAYING") return;

    const playerEntities = gameModel.getComponentActives("PlayerInput");
    if (playerEntities.length === 0) return;

    const pi = gameModel.getTypedUnsafe(PlayerInput, playerEntities[0]);
    if (!pi.keyMap) return;
    const prev = pi.prevKeyMap ?? new Map<string, boolean>();

    let moved = false;

    if (keyPressed(["up", "w"], pi.keyMap, prev)) {
      moved = tryMove(board, 0, -1);
    } else if (keyPressed(["down", "s"], pi.keyMap, prev)) {
      moved = tryMove(board, 0, 1);
    } else if (keyPressed(["left", "a"], pi.keyMap, prev)) {
      moved = tryMove(board, -1, 0);
    } else if (keyPressed(["right", "d"], pi.keyMap, prev)) {
      moved = tryMove(board, 1, 0);
    }

    // Undo with Q
    if (keyPressed(["q"], pi.keyMap, prev)) {
      popUndo(board);
    }

    // Check win
    if (moved && checkWin(board)) {
      board.status = "WIN";
    }
  };
}

// ── Format context ────────────────────────────────────────────────────────────

function formatContext(board: SokobanBoard) {
  const WALL_COLOR = "#333333";
  const FLOOR_COLOR = "#1a1a2e";
  const PLAYER_COLOR = "#4488ff";
  const BOX_COLOR = "#cc8833";
  const BOX_ON_TARGET = "#44cc44";
  const TARGET_COLOR = "#663333";

  const totalCells = board.levelWidth * board.levelHeight;
  const cells = Array.from({ length: totalCells }, (_, i) => {
    const x = i % board.levelWidth;
    const y = Math.floor(i / board.levelWidth);

    if (board.walls[i] === 1) return { color: WALL_COLOR };
    if (board.boxes[i] === 1) {
      return { color: board.targets[i] === 1 ? BOX_ON_TARGET : BOX_COLOR };
    }
    if (x === board.playerX && y === board.playerY) return { color: PLAYER_COLOR };
    if (board.targets[i] === 1) return { color: TARGET_COLOR };
    return { color: FLOOR_COLOR };
  });

  let statusMessage = `Level ${board.currentLevel + 1}  Moves: ${board.moves}`;
  if (board.status === "WIN") statusMessage = `Level Complete! Moves: ${board.moves}`;

  return {
    cells,
    statusMessage,
    showWin: board.status === "WIN",
    gridWidth: board.levelWidth,
    gridHeight: board.levelHeight,
  };
}

// ── Draw / UI System ──────────────────────────────────────────────────────────

@System(SokobanBoard)
export class SokobanUISystem extends DrawSystemImpl<ReadOnlyGameModel> {
  uiService: UIService;
  uiMap: UiMap;
  uiElements: UIElement[] = [];

  constructor(query: QueryInstance) {
    super(query);
    this.uiService = UIService.getInstance();
  }

  init = (gameModel: ReadOnlyGameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(SokobanBoard, entity);
    const uiAsset = AssetLoader.getInstance().getUi(board.uiMap);
    this.uiMap = buildUiMap(uiAsset);

    const initialContext = formatContext(board);

    const eventHandler = (playerIndex: number, eventName: string, _eventType: string, _context: any) => {
      const mutableGameModel = gameModel as any as GameModel;
      const mutableBoard = mutableGameModel.getTypedUnsafe(SokobanBoard, entity);

      if (eventName === "onRestartClick") {
        loadLevel(mutableBoard, mutableBoard.currentLevel);
      }
      if (eventName === "onNextLevelClick") {
        mutableBoard.currentLevel = (mutableBoard.currentLevel + 1) % LEVELS.length;
        loadLevel(mutableBoard, mutableBoard.currentLevel);
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
    const board = gameModel.getTypedUnsafe(SokobanBoard, entity);
    this.uiMap.update(formatContext(board));
  };

  cleanup = () => {
    if (this.uiElements.length) {
      this.uiService.removeFromUI(this.uiElements);
      this.uiElements = [];
    }
  };
}