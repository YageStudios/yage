import { System, SystemImpl } from "minecs";
import type { GameModel } from "yage/game/GameModel";
import { Transform } from "yage/schemas/entity/Transform";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { PixiGraphic } from "yage/schemas/render/PixiGraphic";
import { keyDown } from "yage/utils/keys";
import { BrickUpBall, BrickUpPaddle } from "./BrickUpComponents";
import {
  acrossSide,
  alongSide,
  CENTER_X,
  CENTER_Y,
  FIELD_HALF,
  getBoard,
  isHorizontalSide,
  paddleWidthMult,
  PADDLE_OFF,
  PADDLE_SPEED,
  PADDLE_T,
  PADDLE_W,
  sideNormal,
} from "./BrickUpField";
import { playerEntityForPid } from "./BrickUpPlayers";

const clampToSide = (position: number, half: number): number => Math.max(-half, Math.min(half, position));

// Deterministic goalkeeper AI: chase the along-side intercept of the ball
// that will reach this side soonest; drift back to center when nothing is
// coming. Pure sim-state math, so every peer computes the same motion.
const aiMove = (gameModel: GameModel, paddle: BrickUpPaddle, transform: Transform): number => {
  const board = getBoard(gameModel);
  const n = sideNormal(paddle.side);
  const paddleAcross = FIELD_HALF - PADDLE_OFF;

  let bestTime = Infinity;
  let target = 0;
  for (const ballEntity of board.ballEntities) {
    if (!gameModel.isActive(ballEntity)) {
      continue;
    }
    const ball = gameModel.getTypedUnsafe(BrickUpBall, ballEntity);
    const ballTransform = gameModel.getTypedUnsafe(Transform, ballEntity);
    const lx = ballTransform.x - CENTER_X;
    const ly = ballTransform.y - CENTER_Y;
    const closing = -(ball.vx * n.x + ball.vy * n.y);
    if (closing <= 0.01) {
      continue;
    }
    const time = (paddleAcross - acrossSide(paddle.side, lx, ly)) / closing;
    if (time < 0 || time >= bestTime) {
      continue;
    }
    bestTime = time;
    target = alongSide(paddle.side, lx, ly) + alongSide(paddle.side, ball.vx, ball.vy) * time;
  }

  const current = alongSide(paddle.side, transform.x - CENTER_X, transform.y - CENTER_Y);
  const delta = target - current;
  return Math.max(-1, Math.min(1, delta / PADDLE_SPEED));
};

// Paddle movement: human paddles read their PlayerInput keyMap (identical on
// every peer through lockstep frames), AI paddles (`ownerPid === ""`) run the
// deterministic chase. Both share clamping, the REVERSE flip, visual sync
// and upgrade timers.
@System(BrickUpPaddle)
export class BrickUpPaddleSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = 100;

  run = (gameModel: GameModel, entity: number) => {
    const paddle = gameModel.getTypedUnsafe(BrickUpPaddle, entity);
    const transform = gameModel.getTypedUnsafe(Transform, entity);
    const horizontal = isHorizontalSide(paddle.side);

    let move = 0;
    if (paddle.ownerPid !== "") {
      const playerEntity = playerEntityForPid(gameModel, paddle.ownerPid);
      const input = playerEntity !== undefined ? gameModel.getTypedUnsafe(PlayerInput, playerEntity) : null;
      if (input?.keyMap) {
        if (horizontal) {
          move =
            (keyDown(["right", "d"], input.keyMap) ? 1 : 0) - (keyDown(["left", "a"], input.keyMap) ? 1 : 0);
        } else {
          move = (keyDown(["down", "s"], input.keyMap) ? 1 : 0) - (keyDown(["up", "w"], input.keyMap) ? 1 : 0);
        }
      }
    } else {
      move = aiMove(gameModel, paddle, transform);
    }

    if (paddle.reversedTimer > 0) {
      move = -move;
    }

    if (move !== 0) {
      if (horizontal) {
        transform.x += move * PADDLE_SPEED;
      } else {
        transform.y += move * PADDLE_SPEED;
      }
    }

    // A paddle travels its whole side but never past the corners.
    const half = FIELD_HALF - PADDLE_W / 2;
    if (horizontal) {
      transform.x = clampToSide(transform.x - CENTER_X, half) + CENTER_X;
    } else {
      transform.y = clampToSide(transform.y - CENTER_Y, half) + CENTER_Y;
    }

    const width = PADDLE_W * paddleWidthMult(paddle);
    const graphic = gameModel.getTypedUnsafe(PixiGraphic, entity);
    graphic.rectangle = horizontal
      ? { x: 0, y: 0, width, height: PADDLE_T }
      : { x: 0, y: 0, width: PADDLE_T, height: width };

    if (paddle.wideTimer > 0) {
      paddle.wideTimer -= 1;
    }
    if (paddle.reversedTimer > 0) {
      paddle.reversedTimer -= 1;
    }
  };
}
