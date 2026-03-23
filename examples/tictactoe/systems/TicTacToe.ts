import { Component, defaultValue, DrawSystemImpl, QueryInstance, Schema, System, SystemImpl, type } from "minecs";
import type { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import { UIService } from "yage/ui/UIService";
import AssetLoader from "yage/loader/AssetLoader";
import type { UiMap } from "yage/ui/UiMap";
import { buildUiMap } from "yage/ui/UiMap";
import type { UIElement } from "yage/ui/UIElement";

// ── Component ────────────────────────────────────────────────────────────────

@Component()
export class TicTacToeState extends Schema {
  @type(["string"])
  @defaultValue(["", "", "", "", "", "", "", "", ""])
  cells: string[];

  @type("string")
  @defaultValue("X")
  turn: string;

  @type("string")
  @defaultValue("PLAYING")
  status: string;

  @type("string")
  @defaultValue("core/TicTacToeUI")
  uiMap: string;

  @type("number")
  @defaultValue(-1)
  cursorIndex: number;

  @type("number")
  @defaultValue(0)
  currentPlayer: number;
}

// ── Win check helper ─────────────────────────────────────────────────────────

const WIN_LINES = [
  [0, 1, 2],
  [3, 4, 5],
  [6, 7, 8],
  [0, 3, 6],
  [1, 4, 7],
  [2, 5, 8],
  [0, 4, 8],
  [2, 4, 6],
];

function checkWinOrDraw(state: TicTacToeState): void {
  for (const [a, b, c] of WIN_LINES) {
    if (state.cells[a] !== "" && state.cells[a] === state.cells[b] && state.cells[b] === state.cells[c]) {
      state.status = state.cells[a] + "_WINS";
      return;
    }
  }
  if (state.cells.every((c) => c !== "")) {
    state.status = "DRAW";
  }
}

// ── Format helpers ───────────────────────────────────────────────────────────

function formatStatusMessage(state: TicTacToeState): string {
  switch (state.status) {
    case "X_WINS":
      return "X Wins!";
    case "O_WINS":
      return "O Wins!";
    case "DRAW":
      return "Draw!";
    default:
      return "Turn: " + state.turn;
  }
}

function formatContext(state: TicTacToeState) {
  return {
    statusMessage: formatStatusMessage(state),
    showReset: state.status !== "PLAYING",
    cells: state.cells.map((mark, i) => ({ mark, cellIndex: i })),
    cursorIndex: state.cursorIndex,
    currentPlayer: state.currentPlayer,
  };
}

// ── Init System ──────────────────────────────────────────────────────────────

@System(TicTacToeState)
export class TicTacToeSystem extends SystemImpl<GameModel> {
  static category = 0; // CORE
  static depth = 0;

  init = (gameModel: GameModel, entity: number) => {
    const state = gameModel.getTypedUnsafe(TicTacToeState, entity);
    state.cells = ["", "", "", "", "", "", "", "", ""];
    state.turn = "X";
    state.status = "PLAYING";
    state.cursorIndex = -1;
  };
}

// ── Draw / UI System ─────────────────────────────────────────────────────────

@System(TicTacToeState)
export class TicTacToeUISystem extends DrawSystemImpl<ReadOnlyGameModel> {
  uiService: UIService;
  uiMap: UiMap;
  uiElements: UIElement[] = [];

  constructor(query: QueryInstance) {
    super(query);
    this.uiService = UIService.getInstance();
  }

  init = (gameModel: ReadOnlyGameModel, entity: number) => {
    const state = gameModel.getTypedUnsafe(TicTacToeState, entity);
    const uiAsset = AssetLoader.getInstance().getUi(state.uiMap);
    this.uiMap = buildUiMap(uiAsset);

    const initialContext = formatContext(state);

    const eventHandler = (playerIndex: number, eventName: string, _eventType: string, context: any) => {
      // Use mutable reference for state updates
      const mutableState = (gameModel as any as GameModel).getTypedUnsafe(TicTacToeState, entity);

      if (eventName === "onCellClick") {
        const cellIndex = context.$index ?? context.cellIndex;
        if (mutableState.status === "PLAYING" && mutableState.cells[cellIndex] === "") {
          // In coop mode: playerIndex 0 is mouse (X), playerIndex 1 is keyboard (O)
          // Enforce turn order based on player index
          const playerMark = playerIndex === 0 ? "X" : "O";
          if (mutableState.turn !== playerMark) {
            return; // Not this player's turn
          }
          mutableState.cells[cellIndex] = mutableState.turn;
          checkWinOrDraw(mutableState);
          if (mutableState.status === "PLAYING") {
            mutableState.turn = mutableState.turn === "X" ? "O" : "X";
            mutableState.currentPlayer = mutableState.currentPlayer === 0 ? 1 : 0;
          }
        }
      }

      if (eventName === "onRestartClick") {
        mutableState.cells = ["", "", "", "", "", "", "", "", ""];
        mutableState.turn = "X";
        mutableState.status = "PLAYING";
        mutableState.cursorIndex = -1;
        mutableState.currentPlayer = 0;
      }
    };

    const built = this.uiMap.build(initialContext, eventHandler);
    this.uiElements = Object.values(built);
    for (const el of this.uiElements) {
      this.uiService.addToUI(el);
    }

    // Enable keyboard capture for UI focus navigation (arrows + space to click)
    this.uiService.enableKeyCapture(gameModel.inputManager);
  };

  run = (gameModel: ReadOnlyGameModel, entity: number) => {
    if (!this.uiElements.length) {
      return;
    }
    if (this.uiElements.some((ui) => ui.destroyed)) {
      this.init(gameModel, entity);
      return;
    }
    const state = gameModel.getTypedUnsafe(TicTacToeState, entity);
    this.uiMap.update(formatContext(state));
  };

  cleanup = () => {
    if (this.uiElements.length) {
      this.uiService.removeFromUI(this.uiElements);
      this.uiElements = [];
    }
  };
}