import { Component, defaultValue, DrawSystemImpl, Schema, System, SystemImpl, type } from "minecs";
import type { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import { Button, Column, Grid, Model, Panel, Text, UIFinal, connectInput, each, when } from "yage/ui/final";
import type { Child } from "yage/ui/final";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { canPresentUI } from "../../shared/uiFinal";

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

/**
 * Which captain this browser controls. Null for a shared screen (local
 * hot-seat), where moves are attributed to the current turn instead. Set by
 * the boot path for online games.
 */
export const tictactoeIdentity = { selfNetId: null as string | null };

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

// ── Presentation projection ───────────────────────────────────────────────────

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

interface TicTacToeHudState {
  statusMessage: string;
  playerText: string;
  showReset: boolean;
  turn: string;
  /** False while an online captain has not materialized in the shared world. */
  ready: boolean;
  cells: string[];
}

// These read only; the simulation passes its mutable model, draw passes the read-only one.
function getOrderedPlayerIds(gameModel: GameModel | ReadOnlyGameModel): string[] {
  return gameModel
    .getComponentActives("PlayerInput")
    .map((entity) => gameModel.getTypedUnsafe(PlayerInput, entity).pid)
    .filter((pid, index, list) => !!pid && list.indexOf(pid) === index);
}

function getPlayerMarkByNetId(gameModel: GameModel | ReadOnlyGameModel, netId: string): string {
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

// ── UI Final board ────────────────────────────────────────────────────────────

@System(TicTacToeState)
export class TicTacToeUISystem extends DrawSystemImpl<ReadOnlyGameModel> {
  private ui?: UIFinal;
  private state?: Model<TicTacToeHudState>;

  init = (gameModel: ReadOnlyGameModel, _entity: number) => {
    // Headless runs (unit tests) have no real DOM; the board is presentation-only.
    if (!canPresentUI() || this.ui) return;
    const ui = (this.ui = new UIFinal());
    const state = (this.state = new Model<TicTacToeHudState>({
      statusMessage: "Turn: X",
      playerText: "current player 0",
      showReset: false,
      turn: "X",
      ready: true,
      cells: ["", "", "", "", "", "", "", "", ""],
    }));
    ui.scope.add(() => { this.state = undefined; state.dispose(); });
    ui.mount(this.board(state, gameModel));
    // The board is this scene's whole interaction surface, so the bridge owns
    // menu keys (arrows move, space/enter places a mark) at all times.
    // Key releases still reach gameplay so held keys never stick.
    connectInput(gameModel.inputManager, ui, { active: () => true });
  };

  private board(state: Model<TicTacToeHudState>, gameModel: ReadOnlyGameModel): Child {
    const cellSize = "min(93px, 26vw)";
    return Panel({
      id: "mainColumn",
      style: {
        position: "absolute", inset: 0, display: "grid", placeItems: "center", gap: 32,
      },
    },
      Column({ id: "topInfo", style: { alignItems: "center", gap: 10 } },
        Text(() => state.get<string>("statusMessage"), {
          id: "statusText",
          style: { fontSize: 48, color: "#ffffff", textShadow: "2px 2px 4px #000000" },
        }),
        Text(() => state.get<string>("playerText"), {
          id: "playerText",
          style: { fontSize: 48, color: "#ffffff", textShadow: "2px 2px 4px #000000" },
        })),
      Grid({
        id: "boardGrid",
        focusScope: "board",
        style: {
          gridTemplateColumns: `repeat(3, ${cellSize})`, gridAutoRows: cellSize,
          gap: 5, padding: 5, backgroundColor: "#222222", borderRadius: 8,
        },
      }, when(() => state.get<boolean>("ready"), () =>
        each(state.select<readonly string[]>("cells"), (_, index) => index, (mark, index) =>
          Button({
            label: () => mark.get() || `Cell ${index.get() + 1}`,
            style: {
              fontSize: 64, backgroundColor: "#444444", color: "#ffffff",
              borderRadius: 4, fontFamily: "inherit", padding: 0,
              display: "grid", placeItems: "center",
            },
            on: {
              activate: event => this.placeMark(gameModel, event.player, index.peek()),
            },
          }, Text(() => mark.get()))), () =>
        Text("Waiting for the shared airport…", {
          style: { fontSize: 16, color: "#9fb8d8" },
        }))),
      when(() => state.get<boolean>("showReset"), () =>
        Button({
          id: "resetButton",
          autoFocus: true,
          style: {
            minWidth: 200, minHeight: 60, fontSize: 28,
            backgroundColor: "#4CAF50", color: "#ffffff", borderRadius: 8,
          },
          on: { activate: event => this.restart(gameModel, event.player) },
        }, "Restart Game")));
  }

  /**
   * Marks move through the authoritative event stream; TicTacToeSystem validates them.
   * Online, each browser owns one captain (selfNetId) and always acts as itself.
   * Shared-keyboard hot-seat owns both captains and a click has no identity, so
   * it acts as whoever the turn says. gameModel.localNetIds is sorted and holds
   * every known player, so positional indexing would attribute moves to the
   * wrong captain.
   */
  private placeMark(gameModel: ReadOnlyGameModel, playerIndex: number, cellIndex: number): void {
    const netIds = gameModel.localNetIds;
    const netId = tictactoeIdentity.selfNetId
      ?? netIds.find(netId => getPlayerMarkByNetId(gameModel, netId) === this.state?.get<string>("turn"))
      ?? netIds[playerIndex]
      ?? netIds[0];
    if (netId) {
      gameModel.event(netId, TIC_TAC_TOE_EVENTS.PLACE_MARK, { cellIndex });
    }
  }

  private restart(gameModel: ReadOnlyGameModel, playerIndex: number): void {
    const netId = gameModel.localNetIds[playerIndex] ?? gameModel.localNetIds[0];
    if (netId) {
      gameModel.event(netId, TIC_TAC_TOE_EVENTS.RESTART, {});
    }
  }

  run = (gameModel: ReadOnlyGameModel, entity: number) => {
    if (!this.state) return;
    const state = gameModel.getTypedUnsafe(TicTacToeState, entity);
    this.state.set("statusMessage", formatStatusMessage(state));
    this.state.set("playerText", `current player ${state.currentPlayer}`);
    this.state.set("showReset", state.status !== "PLAYING");
    this.state.set("turn", state.turn);
    this.state.set("cells", [...state.cells]);
    // Online: the board unlocks once this browser's captain materialized in
    // the shared world (the join grace frame run); local boots are born ready.
    const selfNet = tictactoeIdentity.selfNetId;
    if (!selfNet) {
      this.state.set("ready", true);
      return;
    }
    let ready = false;
    for (const playerEntity of gameModel.getComponentActives("PlayerInput")) {
      if (gameModel.getTypedUnsafe(PlayerInput, playerEntity).pid === selfNet) {
        ready = true;
        break;
      }
    }
    this.state.set("ready", ready);
  };

  cleanup = () => {
    this.ui?.dispose();
    this.ui = undefined;
  };
}
