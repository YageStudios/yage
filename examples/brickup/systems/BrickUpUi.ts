import { DrawSystemImpl, System } from "minecs";
import type { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import { Column, Model, Text, UIFinal } from "yage/ui/final";
import type { Style } from "yage/ui/final";
import { BrickUpBoard, BrickUpPaddle } from "./BrickUpComponents";
import { paddleForSide } from "./BrickUpPlayers";
import { canPresentUI } from "../../shared/uiFinal";

const LIVES_FULL = "❤";
const LIVES_EMPTY = "·";

// One status line per side: who owns it, their score and remaining lives.
const sideStatus = (gameModel: ReadOnlyGameModel, side: number): string => {
  const paddleEntity = paddleForSide(gameModel as GameModel, side);
  if (paddleEntity === undefined) {
    return `SIDE ${side} · OPEN`;
  }
  const paddle = gameModel.getTypedUnsafe(BrickUpPaddle, paddleEntity);
  const localPid = gameModel.localNetIds[0];
  const owner =
    paddle.ownerPid === ""
      ? "AI"
      : paddle.ownerPid === localPid
        ? "YOU"
        : paddle.ownerPid.toUpperCase();
  const lives = LIVES_FULL.repeat(Math.max(0, paddle.lives)) + LIVES_EMPTY.repeat(Math.max(0, 3 - paddle.lives));
  return `SIDE ${side} · ${owner} · ${paddle.score} PTS · ${lives}`;
};

interface BrickUpHudState {
  round: string;
  mode: string;
  p0: string;
  p1: string;
  p2: string;
  p3: string;
}

// The HUD. Presentation-only: a UIFinal root mounted on document.body in the
// draw step, and skipped entirely headless where there is no DOM to mount on.
@System(BrickUpBoard)
export class BrickUpUISystem extends DrawSystemImpl<ReadOnlyGameModel> {
  private ui?: UIFinal;
  private state?: Model<BrickUpHudState>;

  init = (_gameModel: ReadOnlyGameModel) => {
    if (!canPresentUI() || this.ui) return;
    const ui = (this.ui = new UIFinal());
    const state = (this.state = new Model<BrickUpHudState>({
      round: "1", mode: "MANUAL", p0: "", p1: "", p2: "", p3: "",
    }));
    ui.scope.add(() => { this.state = undefined; state.dispose(); });
    ui.mount(this.hud(state));
  };

  private hud(state: Model<BrickUpHudState>) {
    const side = (path: "p0" | "p1" | "p2" | "p3", style: Style) =>
      Text(() => state.get<string>(path), {
        id: path,
        style: { position: "absolute", fontFamily: "monospace", fontSize: 18, textShadow: "0 0 4px #000000", ...style },
      });

    return [
      Column({
        id: "titleGroup",
        style: { position: "absolute", top: 12, left: 15, gap: 4 },
      },
        Text("BRICKUP", {
          style: { fontSize: 26, color: "#dfe6f3", fontFamily: "monospace", textShadow: "0 0 4px #000000" },
        }),
        Text(() => `ROUND ${state.get<string>("round")} · ${state.get<string>("mode")}`, {
          id: "round",
          style: { fontSize: 14, color: "#8a94a8", fontFamily: "monospace" },
        })),
      side("p0", { bottom: 18, left: "50%", transform: "translateX(-50%)", color: "#66ccff", textAlign: "center" }),
      side("p1", { top: 42, left: "50%", transform: "translateX(-50%)", color: "#ffcc66", textAlign: "center" }),
      side("p2", { left: 12, top: "50%", transform: "translateY(-50%)", color: "#88ff88" }),
      side("p3", { right: 12, top: "50%", transform: "translateY(-50%)", color: "#ff88aa", textAlign: "right" }),
      Text("A/D or ←/→ move horizontal paddles · W/S or ↑/↓ move vertical paddles", {
        id: "controls",
        style: { position: "absolute", bottom: 12, left: 15, fontSize: 13, color: "#77839a", fontFamily: "monospace" },
      }),
    ];
  }

  run = (gameModel: ReadOnlyGameModel) => {
    if (!this.state) return;
    const board = gameModel.getTypedUnsafe(BrickUpBoard, gameModel.coreEntity);
    this.state.set("round", String(board.round));
    this.state.set("mode", board.physicsMode === "rapier" ? "RAPIER" : "MANUAL");
    this.state.set("p0", sideStatus(gameModel, 0));
    this.state.set("p1", sideStatus(gameModel, 1));
    this.state.set("p2", sideStatus(gameModel, 2));
    this.state.set("p3", sideStatus(gameModel, 3));
  };

  cleanup = () => {
    this.ui?.dispose();
    this.ui = undefined;
  };
}
