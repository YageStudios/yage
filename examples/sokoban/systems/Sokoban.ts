import { Component, defaultValue, DrawSystemImpl, Schema, System, SystemImpl, type } from "minecs";
import type { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import { Button, Column, CommandQueue, Grid, Model, Panel, Text, UIFinal, connectInput, each, when } from "yage/ui/final";
import type { Child } from "yage/ui/final";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { keyPressed } from "yage/utils/keys";
import { canPresentUI } from "../../shared/uiFinal";

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

    // HUD commands are applied here — the authoritative gameplay input point.
    // Drained before the status check so restart/next-level also work after a win.
    gameModel.getSystem(SokobanUISystem)?.commands.drain(command => {
      const mutableBoard = gameModel.getTypedUnsafe(SokobanBoard, entity);
      if (command.type === "restart") {
        loadLevel(mutableBoard, mutableBoard.currentLevel);
      } else if (command.type === "next-level") {
        mutableBoard.currentLevel = (mutableBoard.currentLevel + 1) % LEVELS.length;
        loadLevel(mutableBoard, mutableBoard.currentLevel);
      }
    });

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

// ── Presentation projection ───────────────────────────────────────────────────

const CELL_COLORS = {
  WALL: "#333333", FLOOR: "#1a1a2e", PLAYER: "#4488ff",
  BOX: "#cc8833", BOX_ON_TARGET: "#44cc44", TARGET: "#663333",
};

function boardCells(board: SokobanBoard): string[] {
  const totalCells = board.levelWidth * board.levelHeight;
  const cells = new Array<string>(totalCells);
  for (let i = 0; i < totalCells; i++) {
    if (board.walls[i] === 1) {
      cells[i] = CELL_COLORS.WALL;
    } else if (board.boxes[i] === 1) {
      cells[i] = board.targets[i] === 1 ? CELL_COLORS.BOX_ON_TARGET : CELL_COLORS.BOX;
    } else if (i === board.playerY * board.levelWidth + board.playerX) {
      cells[i] = CELL_COLORS.PLAYER;
    } else if (board.targets[i] === 1) {
      cells[i] = CELL_COLORS.TARGET;
    } else {
      cells[i] = CELL_COLORS.FLOOR;
    }
  }
  return cells;
}

function statusMessage(board: SokobanBoard): string {
  if (board.status === "WIN") return `Level Complete! Moves: ${board.moves}`;
  return `Level ${board.currentLevel + 1}  Moves: ${board.moves}`;
}

interface SokobanHudState {
  statusMessage: string;
  showWin: boolean;
  cells: string[];
  gridWidth: number;
  gridHeight: number;
}

// ── UI Final HUD ──────────────────────────────────────────────────────────────

@System(SokobanBoard)
export class SokobanUISystem extends DrawSystemImpl<ReadOnlyGameModel> {
  /** Commands from the HUD; drained by SokobanSystem at the gameplay input boundary. */
  readonly commands = new CommandQueue();
  private ui?: UIFinal;
  private state?: Model<SokobanHudState>;

  init = (gameModel: ReadOnlyGameModel, _entity: number) => {
    // Headless runs (unit tests) have no real DOM; the HUD is presentation-only.
    if (!canPresentUI() || this.ui) return;
    const ui = (this.ui = new UIFinal());
    const state = (this.state = new Model<SokobanHudState>({
      statusMessage: "", showWin: false, cells: [], gridWidth: 0, gridHeight: 0,
    }));
    ui.scope.add(() => { this.state = undefined; state.dispose(); });
    ui.mount(this.hud(state));
    // The bridge owns the keys only while the win overlay is up; gameplay
    // keeps arrows/WASD/Q while playing. Releases always pass through.
    connectInput(gameModel.inputManager, ui, {
      active: () => state.select<boolean>("showWin").peek(),
    });
  };

  private hud(state: Model<SokobanHudState>): Child {
    return [
      Text(() => state.get<string>("statusMessage"), {
        id: "statusText",
        style: {
          position: "absolute", top: 20, left: "50%", transform: "translateX(-50%)",
          fontSize: 32, color: "#ffffff", textAlign: "center",
        },
      }),
      Grid({
        id: "fieldGrid",
        style: {
          position: "absolute", left: "50%", top: "50%", transform: "translate(-50%, -50%)",
          gridTemplateColumns: () => `repeat(${state.get<number>("gridWidth")}, 38px)`,
          gridAutoRows: "38px", gap: 2, padding: 2,
          backgroundColor: "#0a0a0a", border: "2px solid #333366", borderRadius: 6,
        },
      }, each(state.select<readonly string[]>("cells"), (_, index) => index, color =>
        Panel({ style: { width: 38, height: 38, borderRadius: 4, background: () => color.get() } }))),
      Column({
        id: "bottomGroup",
        style: {
          position: "absolute", bottom: 25, left: "50%", transform: "translateX(-50%)",
          alignItems: "center", gap: 10,
        },
      },
        Button({
          id: "restartButton",
          style: { minWidth: 180, minHeight: 48, fontSize: 22, backgroundColor: "#cc4444", color: "#ffffff", borderRadius: 8 },
          on: { activate: event => { this.commands.enqueue(event.player, "restart"); } },
        }, "Restart Level"),
        Text("WASD/Arrows move  |  Q undo", {
          style: { fontSize: 14, color: "#555577", textAlign: "center" },
        }),
        Text("Blue=You  Brown=Box  DarkRed=Target  Green=Box on Target", {
          style: { fontSize: 12, color: "#444455", textAlign: "center" },
        })),
      when(() => state.get<boolean>("showWin"), () =>
        Panel({
          id: "winGroup",
          style: { position: "absolute", inset: 0, display: "grid", placeItems: "center" },
        },
          Column({ style: { alignItems: "center", gap: 24 } },
            Text(() => state.get<string>("statusMessage"), {
              id: "winText",
              style: {
                fontSize: 48, color: "#44ff44", textAlign: "center",
                textShadow: "0 0 20px #00ff00",
              },
            }),
            Button({
              id: "nextLevelButton",
              autoFocus: true,
              style: {
                minWidth: 220, minHeight: 64, fontSize: 28,
                backgroundColor: "#4CAF50", color: "#ffffff", borderRadius: 8,
              },
              on: { activate: event => { this.commands.enqueue(event.player, "next-level"); } },
            }, "Next Level")))),
    ];
  }

  run = (gameModel: ReadOnlyGameModel, entity: number) => {
    if (!this.state) return;
    const board = gameModel.getTypedUnsafe(SokobanBoard, entity);
    this.state.set("statusMessage", statusMessage(board));
    this.state.set("showWin", board.status === "WIN");
    this.state.set("cells", boardCells(board));
    this.state.set("gridWidth", board.levelWidth);
    this.state.set("gridHeight", board.levelHeight);
  };

  cleanup = () => {
    this.ui?.dispose();
    this.ui = undefined;
  };
}