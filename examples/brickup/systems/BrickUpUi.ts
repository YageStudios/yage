import type { QueryInstance } from "minecs";
import { DrawSystemImpl, System } from "minecs";
import type { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import { UIService } from "yage/ui/UIService";
import AssetLoader from "yage/loader/AssetLoader";
import type { UiMap } from "yage/ui/UiMap";
import { buildUiMap } from "yage/ui/UiMap";
import type { UIElement } from "yage/ui/UIElement";
import { BrickUpBoard, BrickUpPaddle } from "./BrickUpComponents";
import { paddleForSide } from "./BrickUpPlayers";

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

const formatContext = (gameModel: ReadOnlyGameModel) => {
  const board = gameModel.getTypedUnsafe(BrickUpBoard, gameModel.coreEntity);
  return {
    round: String(board.round),
    mode: board.physicsMode === "rapier" ? "RAPIER" : "MANUAL",
    p0: sideStatus(gameModel, 0),
    p1: sideStatus(gameModel, 1),
    p2: sideStatus(gameModel, 2),
    p3: sideStatus(gameModel, 3),
    controls: "A/D or ←/→ move horizontal paddles · W/S or ↑/↓ move vertical paddles",
  };
};

// The HUD. Registered on the board; renders in the browser only (draw step),
// and degrades silently headless where the UI asset was never loaded.
@System(BrickUpBoard)
export class BrickUpUISystem extends DrawSystemImpl<ReadOnlyGameModel> {
  uiService: UIService;
  uiMap: UiMap;
  uiElements: UIElement[] = [];

  constructor(query: QueryInstance) {
    super(query);
    this.uiService = UIService.getInstance();
  }

  init = (gameModel: ReadOnlyGameModel) => {
    // The loader throws on unknown templates; headless runs (unit tests)
    // never load the UI asset, so absence silently disables the HUD.
    let uiAsset;
    try {
      uiAsset = AssetLoader.getInstance().getUi("BrickUpUI");
    } catch {
      return;
    }
    if (!uiAsset) {
      return;
    }
    this.uiMap = buildUiMap(uiAsset);
    const built = this.uiMap.build(formatContext(gameModel), () => {});
    this.uiElements = Object.values(built);
    for (const element of this.uiElements) {
      this.uiService.addToUI(element);
    }
  };

  run = (gameModel: ReadOnlyGameModel) => {
    if (!this.uiElements.length || !this.uiMap) {
      return;
    }
    if (this.uiElements.some((ui) => ui.destroyed)) {
      this.init(gameModel);
      return;
    }
    this.uiMap.update(formatContext(gameModel));
  };

  cleanup = () => {
    // One element at a time: the array fast-path mis-splices after onDestroy
    // already detached each element from the root.
    for (const element of this.uiElements) {
      if (!element.destroyed) {
        this.uiService.removeFromUI(element);
      }
    }
    this.uiElements = [];
  };
}
