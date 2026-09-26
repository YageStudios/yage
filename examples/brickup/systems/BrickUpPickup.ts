import { System, SystemImpl } from "minecs";
import type { GameModel } from "yage/game/GameModel";
import { Transform } from "yage/schemas/entity/Transform";
import { BrickUpBoard, BrickUpPaddle, BrickUpPickup } from "./BrickUpComponents";
import {
  applyUpgrade,
  CENTER_X,
  CENTER_Y,
  FIELD_HALF,
  isHorizontalSide,
  paddleWidthMult,
  PICKUP_SIZE,
  PICKUP_SPEED_MAX,
  PICKUP_STEER,
  PADDLE_T,
  PADDLE_W,
} from "./BrickUpField";

// Pickups drift around the arena, bounce off every boundary (they never
// exit) and upgrade the first paddle they touch, visited in side order.
@System(BrickUpBoard)
export class BrickUpPickupSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = 300;

  run = (gameModel: GameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(BrickUpBoard, entity);
    const collected: number[] = [];

    for (const pickupEntity of board.pickupEntities) {
      if (!gameModel.isActive(pickupEntity)) {
        continue;
      }
      const pickup = gameModel.getTypedUnsafe(BrickUpPickup, pickupEntity);
      const transform = gameModel.getTypedUnsafe(Transform, pickupEntity);

      // Steer gently outward from the arena center so every pickup inevitably
      // drifts into somebody's paddle zone instead of circling the middle.
      const lx0 = transform.x - CENTER_X;
      const ly0 = transform.y - CENTER_Y;
      pickup.vx += Math.sign(lx0) * PICKUP_STEER;
      pickup.vy += Math.sign(ly0) * PICKUP_STEER;
      const speed = Math.sqrt(pickup.vx * pickup.vx + pickup.vy * pickup.vy);
      if (speed > PICKUP_SPEED_MAX) {
        pickup.vx = (pickup.vx / speed) * PICKUP_SPEED_MAX;
        pickup.vy = (pickup.vy / speed) * PICKUP_SPEED_MAX;
      }

      transform.x += pickup.vx;
      transform.y += pickup.vy;

      const lx = transform.x - CENTER_X;
      const ly = transform.y - CENTER_Y;
      // Pickups stay inside paddle-reachable space: the boundary leaves just
      // the paddle thickness of slack beyond the paddle line.
      const bound = FIELD_HALF - PADDLE_T / 2 - PICKUP_SIZE / 2;
      if (Math.abs(lx) > bound || Math.abs(ly) > bound) {
        // Reflect on the axis that crossed; a corner overlap resolves on the
        // deeper axis, deterministically.
        if (Math.abs(lx) - bound > Math.abs(ly) - bound) {
          pickup.vx = Math.abs(pickup.vx) * (lx > 0 ? -1 : 1);
          transform.x = CENTER_X + Math.sign(lx) * bound;
        } else {
          pickup.vy = Math.abs(pickup.vy) * (ly > 0 ? -1 : 1);
          transform.y = CENTER_Y + Math.sign(ly) * bound;
        }
      }

      const paddleEntity = this.collectingPaddle(gameModel, transform);
      if (paddleEntity !== undefined) {
        const paddle = gameModel.getTypedUnsafe(BrickUpPaddle, paddleEntity);
        applyUpgrade(gameModel, board, paddle, pickup.pickupType);
        collected.push(pickupEntity);
      }
    }

    if (collected.length > 0) {
      board.pickupEntities = board.pickupEntities.filter((e) => !collected.includes(e));
      for (const pickupEntity of collected) {
        gameModel.removeEntity(pickupEntity);
      }
    }
  };

  private collectingPaddle(gameModel: GameModel, transform: Transform): number | undefined {
    const paddleEntities = gameModel
      .getComponentActives("BrickUpPaddle")
      .map((entity) => ({ entity, side: gameModel.getTypedUnsafe(BrickUpPaddle, entity).side }))
      .sort((a, b) => a.side - b.side);

    for (const { entity } of paddleEntities) {
      const paddleTransform = gameModel.getTypedUnsafe(Transform, entity);
      const paddle = gameModel.getTypedUnsafe(BrickUpPaddle, entity);
      const dx = transform.x - paddleTransform.x;
      const dy = transform.y - paddleTransform.y;
      const halfAlong = (PADDLE_W * paddleWidthMult(paddle)) / 2 + PICKUP_SIZE / 2;
      const halfAcross = PADDLE_T / 2 + PICKUP_SIZE / 2;
      const overlaps = isHorizontalSide(paddle.side)
        ? Math.abs(dx) <= halfAlong && Math.abs(dy) <= halfAcross
        : Math.abs(dy) <= halfAlong && Math.abs(dx) <= halfAcross;
      if (overlaps) {
        return entity;
      }
    }
    return undefined;
  }
}
