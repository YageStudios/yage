import { Component, defaultValue, DrawSystemImpl, QueryInstance, Schema, System, SystemImpl, type } from "minecs";
import type { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import { UIService } from "yage/ui/UIService";
import AssetLoader from "yage/loader/AssetLoader";
import type { UiMap } from "yage/ui/UiMap";
import { buildUiMap } from "yage/ui/UiMap";
import type { UIElement } from "yage/ui/UIElement";
import { PlayerInput } from "yage/schemas/core/PlayerInput";

// ── Component ────────────────────────────────────────────────────────────────

@Component()
export class TicTacToeState extends Schema {
  @type(["string"])
  @defaultValue(["", "", "", "", "", "", "", "", ""])
  cells: string[];

  @type(["number"])
  @defaultValue([])
  xMoves: number[];

  @type(["number"])
  @defaultValue([])
  oMoves: number[];

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

const TIC_TAC_TOE_EVENTS = {
  PLACE_MARK: "ticTacToe:placeMark",
  RESTART: "ticTacToe:restart",
} as const;

function resetState(state: TicTacToeState): void {
  state.cells = ["", "", "", "", "", "", "", "", ""];
  state.xMoves = [];
  state.oMoves = [];
  state.turn = "X";
  state.status = "PLAYING";
  state.cursorIndex = -1;
  state.currentPlayer = 0;
}

function applyMove(state: TicTacToeState, cellIndex: number): void {
  const playerMark = state.turn;
  const moveHistory = playerMark === "X" ? state.xMoves : state.oMoves;

  if (moveHistory.length >= 3) {
    const oldestMove = moveHistory.shift();
    if (oldestMove !== undefined) {
      state.cells[oldestMove] = "";
    }
  }

  state.cells[cellIndex] = playerMark;
  moveHistory.push(cellIndex);
}

function checkWinOrDraw(state: TicTacToeState): void {
  for (const [a, b, c] of WIN_LINES) {
    if (state.cells[a] !== "" && state.cells[a] === state.cells[b] && state.cells[b] === state.cells[c]) {
      state.status = state.cells[a] + "_WINS";
      return;
    }
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

function getOrderedPlayerIds(gameModel: ReadOnlyGameModel): string[] {
  return gameModel
    .getComponentActives("PlayerInput")
    .map((entity) => gameModel.getTypedUnsafe(PlayerInput, entity).pid)
    .filter((pid, index, list) => !!pid && list.indexOf(pid) === index);
}

function getPlayerMark(gameModel: ReadOnlyGameModel, playerIndex: number): string {
  if (gameModel.localNetIds.length > 1) {
    return playerIndex === 0 ? "X" : "O";
  }

  const localNetId = gameModel.localNetIds[playerIndex] ?? gameModel.localNetIds[0];
  const orderedPlayerIds = getOrderedPlayerIds(gameModel);
  const playerOrder = orderedPlayerIds.indexOf(localNetId);
  return playerOrder <= 0 ? "X" : "O";
}

function getPlayerMarkByNetId(gameModel: ReadOnlyGameModel, netId: string): string {
  const orderedPlayerIds = getOrderedPlayerIds(gameModel);
  const playerOrder = orderedPlayerIds.indexOf(netId);
  return playerOrder <= 0 ? "X" : "O";
}

// ── Init System ──────────────────────────────────────────────────────────────

@System(TicTacToeState)
export class TicTacToeSystem extends SystemImpl<GameModel> {
  static category = 0; // CORE
  static depth = 0;

  init = (gameModel: GameModel, entity: number) => {
    const state = gameModel.getTypedUnsafe(TicTacToeState, entity);
    resetState(state);
  };

  run = (gameModel: GameModel, entity: number) => {
    const state = gameModel.getTypedUnsafe(TicTacToeState, entity);
    const players = gameModel.getComponentActives("PlayerInput");

    for (const playerEntity of players) {
      const playerInput = gameModel.getTypedUnsafe(PlayerInput, playerEntity);
      for (const rawEvent of playerInput.events ?? []) {
        const [eventName, payloadJson = "{}"] = rawEvent.split("::");
        const payload = JSON.parse(payloadJson);

        if (eventName === TIC_TAC_TOE_EVENTS.RESTART) {
          resetState(state);
          continue;
        }

        if (eventName !== TIC_TAC_TOE_EVENTS.PLACE_MARK) {
          continue;
        }

        const cellIndex = payload?.cellIndex;
        if (typeof cellIndex !== "number") {
          continue;
        }
        if (state.status !== "PLAYING" || state.cells[cellIndex] !== "") {
          continue;
        }

        const playerMark = getPlayerMarkByNetId(gameModel, playerInput.pid);
        if (state.turn !== playerMark) {
          continue;
        }

        applyMove(state, cellIndex);
        checkWinOrDraw(state);
        if (state.status === "PLAYING") {
          state.turn = state.turn === "X" ? "O" : "X";
          state.currentPlayer = state.currentPlayer === 0 ? 1 : 0;
        }
      }
    }
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
      if (eventName === "onCellClick") {
        const cellIndex = context.$index ?? context.cellIndex;
        const playerMark = getPlayerMark(gameModel, playerIndex);
        const localState = gameModel.getTypedUnsafe(TicTacToeState, entity);
        if (localState.status === "PLAYING" && localState.cells[cellIndex] === "" && localState.turn === playerMark) {
          const mutableGameModel = gameModel as any as GameModel;
          const playerNetId = mutableGameModel.localNetIds[playerIndex] ?? mutableGameModel.localNetIds[0];
          if (playerNetId) {
            mutableGameModel.event(playerNetId, TIC_TAC_TOE_EVENTS.PLACE_MARK, { cellIndex });
          }
        }
      }

      if (eventName === "onRestartClick") {
        const mutableState = (gameModel as any as GameModel).getTypedUnsafe(TicTacToeState, entity);
        resetState(mutableState);
        const mutableGameModel = gameModel as any as GameModel;
        const playerNetId = mutableGameModel.localNetIds[playerIndex] ?? mutableGameModel.localNetIds[0];
        if (playerNetId) {
          mutableGameModel.event(playerNetId, TIC_TAC_TOE_EVENTS.RESTART, {});
        }
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
