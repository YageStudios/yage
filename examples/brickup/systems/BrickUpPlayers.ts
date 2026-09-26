import { EntityFactory } from "yage/entity/EntityFactory";
import type { GameModel } from "yage/game/GameModel";
import { InputManager } from "yage/inputs/InputManager";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { RigidBox } from "yage/schemas/physics/RigidBox";
import { CollisionCategoryEnum } from "yage/constants/enums";
import { PixiGraphic } from "yage/schemas/render/PixiGraphic";
import { Transform } from "yage/schemas/entity/Transform";
import { System, SystemImpl } from "minecs";
import { keyPressed } from "yage/utils/keys";
import { BrickUpPaddle } from "./BrickUpComponents";
import {
  getBoard,
  isHorizontalSide,
  MAX_SIDES,
  paddleHome,
  PADDLE_T,
  PADDLE_W,
  PLAYER_COLORS,
  START_LIVES,
} from "./BrickUpField";

export const playerEntityForPid = (gameModel: GameModel, pid: string): number | undefined => {
  return gameModel.getComponentActives("PlayerInput").find((entity) => {
    return gameModel.getTypedUnsafe(PlayerInput, entity).pid === pid;
  });
};

export const paddleForSide = (gameModel: GameModel, side: number): number | undefined => {
  return gameModel.getComponentActives("BrickUpPaddle").find((entity) => {
    return gameModel.getTypedUnsafe(BrickUpPaddle, entity).side === side;
  });
};

export const paddleForPid = (gameModel: GameModel, pid: string): number | undefined => {
  return gameModel.getComponentActives("BrickUpPaddle").find((entity) => {
    return gameModel.getTypedUnsafe(BrickUpPaddle, entity).ownerPid === pid;
  });
};

const paintPaddle = (gameModel: GameModel, paddle: number, side: number, horizontal: boolean): void => {
  const graphic = gameModel.getTypedUnsafe(PixiGraphic, paddle);
  graphic.fillColor = PLAYER_COLORS[side % PLAYER_COLORS.length];
  graphic.rectangle = horizontal
    ? { x: 0, y: 0, width: PADDLE_W, height: PADDLE_T }
    : { x: 0, y: 0, width: PADDLE_T, height: PADDLE_W };
};

const spawnPaddle = (gameModel: GameModel, side: number, ownerPid: string): number => {
  const home = paddleHome(side);
  const paddle = EntityFactory.getInstance().generateEntity(gameModel, "BrickUpPaddle");
  const transform = gameModel.getTypedUnsafe(Transform, paddle);
  transform.x = home.x;
  transform.y = home.y;
  const paddleData = gameModel.getTypedUnsafe(BrickUpPaddle, paddle);
  paddleData.side = side;
  paddleData.ownerPid = ownerPid;
  paddleData.lives = START_LIVES;

  const horizontal = isHorizontalSide(side);
  if (getBoard(gameModel).physicsMode === "rapier") {
    // A static body teleported onto the Transform every frame: solid for the
    // solver, moved by the player or the AI. No Locomotion — the RigidBox
    // system would otherwise derive the paddle angle from it.
    gameModel.addComponent(RigidBox, paddle, {
      width: horizontal ? PADDLE_W : PADDLE_T,
      height: horizontal ? PADDLE_T : PADDLE_W,
      isStatic: true,
      restitution: 1,
      friction: 0,
      collisionCategory: CollisionCategoryEnum.WALL,
      collisionMask: [CollisionCategoryEnum.ALL],
    });
  }

  paintPaddle(gameModel, paddle, side, horizontal);
  return paddle;
};

// Sides without a paddle are open goals, so every empty side is handed to an
// AI on the first stepped frame. Runs identically on every peer.
export const fillAiPaddles = (gameModel: GameModel): void => {
  for (let side = 0; side < MAX_SIDES; side++) {
    if (paddleForSide(gameModel, side) === undefined) {
      spawnPaddle(gameModel, side, "");
    }
  }
};

const claimPlayerEntity = (gameModel: GameModel, playerId: string): number => {
  const player = EntityFactory.getInstance().generateEntity(gameModel, "BrickUpPlayer");
  const playerInput = gameModel.getTypedUnsafe(PlayerInput, player);
  playerInput.keyMap = InputManager.buildKeyMap();
  playerInput.pid = playerId;
  return player;
};

// Give `pid` the lowest AI-run side (keeping its lives), or spawn on the
// first free side. Shared by the join flow and the in-game claim system.
export const claimSideFor = (gameModel: GameModel, playerId: string): void => {
  let takeover: number | undefined;
  let free: number | undefined;
  for (let side = 0; side < MAX_SIDES; side++) {
    const paddle = paddleForSide(gameModel, side);
    if (paddle === undefined) {
      free = free ?? side;
      continue;
    }
    if (gameModel.getTypedUnsafe(BrickUpPaddle, paddle).ownerPid === "") {
      takeover = takeover ?? side;
    }
  }

  if (takeover !== undefined) {
    const paddle = paddleForSide(gameModel, takeover);
    if (paddle === undefined) {
      throw new Error("AI paddle missing for takeover");
    }
    gameModel.getTypedUnsafe(BrickUpPaddle, paddle).ownerPid = playerId;
    paintPaddle(gameModel, paddle, takeover, isHorizontalSide(takeover));
    return;
  }

  spawnPaddle(gameModel, free ?? 0, playerId);
};

// Human join: take over the lowest AI-run side, or claim a free side. A
// taken-over paddle keeps its lives, so the game flows through the swap.
export const onPlayerJoin = (gameModel: GameModel, playerId: string): number => {
  // The E2E connection boots a pseudo-player before any simulated join; it
  // spectates so the four real sides stay available.
  if (playerId === "e2e_host") {
    return onObserverJoin(gameModel, playerId);
  }
  claimPlayerEntity(gameModel, playerId);
  claimSideFor(gameModel, playerId);
  const claimedEntity = playerEntityForPid(gameModel, playerId);
  if (claimedEntity === undefined) {
    throw new Error("player entity missing after join");
  }
  return claimedEntity;
};

// Human leave: the paddle stays on the field and reverts to AI control, so
// the rally never dies just because someone dropped.
export const onPlayerLeave = (gameModel: GameModel, playerId: string): void => {
  const player = playerEntityForPid(gameModel, playerId);
  if (player !== undefined) {
    gameModel.removeEntity(player);
  }
  const paddle = paddleForPid(gameModel, playerId);
  if (paddle !== undefined) {
    gameModel.getTypedUnsafe(BrickUpPaddle, paddle).ownerPid = "";
  }
};

// Observer join: engine bookkeeping only, no paddle — the AI owns all four
// sides and the observer watches.
export const onObserverJoin = (gameModel: GameModel, playerId: string): number => {
  return claimPlayerEntity(gameModel, playerId);
};

// A paddle-less player pressing "claim" takes over an AI side. The keypress
// travels through the lockstep input frames, so the takeover happens on
// every peer at the same frame — this is what the multiplayer arena's
// click-to-join is built on.
@System(PlayerInput)
export class BrickUpClaimSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = 60;

  run = (gameModel: GameModel, entity: number) => {
    const input = gameModel.getTypedUnsafe(PlayerInput, entity);
    if (!input.keyMap || !input.prevKeyMap || input.pid === "") {
      return;
    }
    if (!keyPressed(["claim"], input.keyMap, input.prevKeyMap)) {
      return;
    }
    if (paddleForPid(gameModel, input.pid) !== undefined) {
      return;
    }
    claimSideFor(gameModel, input.pid);
  };
}
