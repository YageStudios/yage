import { System, SystemImpl } from "minecs";
import type { GameModel } from "yage/game/GameModel";
import { Transform } from "yage/schemas/entity/Transform";
import { Locomotion } from "yage/schemas/entity/Locomotion";
import { Collisions } from "yage/schemas/physics/Collisions";
import { cos, sin } from "yage/utils/deterministicMath";
import { BrickUpBall, BrickUpBoard, BrickUpBrick, BrickUpPaddle } from "./BrickUpComponents";
import {
  acrossSide,
  alongSide,
  BALL_R,
  BALL_SPEED,
  BRICK_H,
  BRICK_W,
  CENTER_X,
  CENTER_Y,
  DROP_CHANCE,
  FIELD_HALF,
  GOAL_GAP,
  isHorizontalSide,
  MIN_AXIS_COMPONENT,
  paddleWidthMult,
  sideNormal,
  spawnArenaFrame,
  spawnBrickPattern,
  spawnCenterBall,
  spawnPickup,
  MAX_DEFLECT,
  PADDLE_T,
  PADDLE_W,
  RESPAWN_FRAMES,
  SLOW_MULT,
} from "./BrickUpField";
import { fillAiPaddles, paddleForSide } from "./BrickUpPlayers";

// ── Collision helpers ─────────────────────────────────────────────────────────

// Reflects a ball that reached a wall band (the solid parts of the arena
// boundary) and snaps it back inside.
const reflectOnSide = (ball: BrickUpBall, transform: Transform, side: number): void => {
  const n = sideNormal(side);
  const lx = transform.x - CENTER_X;
  const ly = transform.y - CENTER_Y;
  const dot = ball.vx * n.x + ball.vy * n.y;
  if (dot > 0) {
    ball.vx -= 2 * dot * n.x;
    ball.vy -= 2 * dot * n.y;
  }
  const depth = acrossSide(side, lx, ly) - (FIELD_HALF - BALL_R);
  if (depth > 0) {
    transform.x -= n.x * depth;
    transform.y -= n.y * depth;
  }
};

// Handles the whole boundary for one ball: solid wall reflection and goal
// gaps. Returns the side the ball exited through, or -1 when it stayed in.
const resolveBoundary = (ball: BrickUpBall, transform: Transform): number => {
  const lx = transform.x - CENTER_X;
  const ly = transform.y - CENTER_Y;
  for (let side = 0; side < 4; side++) {
    const across = acrossSide(side, lx, ly);
    if (across <= FIELD_HALF - BALL_R) {
      continue;
    }
    const along = Math.abs(alongSide(side, lx, ly));
    if (along < GOAL_GAP / 2) {
      // Inside the goal mouth: the ball keeps flying and may exit.
      if (across > FIELD_HALF + BALL_R) {
        return side;
      }
      continue;
    }
    reflectOnSide(ball, transform, side);
    return -1;
  }
  return -1;
};

// One paddle bounce per ball per frame, angle chosen by where the ball hit
// the paddle (classic breakout control feel). Paddles are visited in side
// order so the outcome never depends on entity iteration order.
const bounceOnPaddles = (gameModel: GameModel, ball: BrickUpBall, transform: Transform): boolean => {
  const paddleEntities = gameModel
    .getComponentActives("BrickUpPaddle")
    .map((entity) => ({ entity, side: gameModel.getTypedUnsafe(BrickUpPaddle, entity).side }))
    .sort((a, b) => a.side - b.side);

  for (const { entity } of paddleEntities) {
    const paddle = gameModel.getTypedUnsafe(BrickUpPaddle, entity);
    const paddleTransform = gameModel.getTypedUnsafe(Transform, entity);

    const lx = transform.x - CENTER_X;
    const ly = transform.y - CENTER_Y;
    const px = paddleTransform.x - CENTER_X;
    const py = paddleTransform.y - CENTER_Y;

    const n = sideNormal(paddle.side);
    const across = acrossSide(paddle.side, lx, ly);
    const paddleAcross = acrossSide(paddle.side, px, py);
    const alongDelta = alongSide(paddle.side, lx, ly) - alongSide(paddle.side, px, py);
    const halfAlong = (PADDLE_W * paddleWidthMult(paddle)) / 2;

    const overlaps =
      Math.abs(across - paddleAcross) < PADDLE_T / 2 + BALL_R && Math.abs(alongDelta) < halfAlong + BALL_R;
    const movingOutward = ball.vx * n.x + ball.vy * n.y > 0;
    if (!overlaps || !movingOutward) {
      continue;
    }

    const speed = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
    const hit = Math.max(-1, Math.min(1, alongDelta / halfAlong));
    const angle = hit * MAX_DEFLECT;
    const inwardX = -n.x;
    const inwardY = -n.y;
    const tangentX = isHorizontalSide(paddle.side) ? 1 : 0;
    const tangentY = isHorizontalSide(paddle.side) ? 0 : 1;
    let dirX = tangentX * sin(angle) + inwardX * cos(angle);
    let dirY = tangentY * sin(angle) + inwardY * cos(angle);

    // Keep a minimum component on both field axes: a near-center hit on a
    // side paddle would otherwise launch a flat, horizontal shot that never
    // climbs back into the brick field.
    if (Math.abs(dirX) < MIN_AXIS_COMPONENT) {
      dirX = (dirX >= 0 ? 1 : -1) * MIN_AXIS_COMPONENT;
    }
    if (Math.abs(dirY) < MIN_AXIS_COMPONENT) {
      dirY = (dirY >= 0 ? 1 : -1) * MIN_AXIS_COMPONENT;
    }
    const dirLen = Math.sqrt(dirX * dirX + dirY * dirY);
    ball.vx = (dirX / dirLen) * speed;
    ball.vy = (dirY / dirLen) * speed;
    ball.lastTouchSide = paddle.side;

    // Snap the ball back onto the field side of the paddle face.
    const depth = across - (paddleAcross - PADDLE_T / 2 - BALL_R);
    if (depth > 0) {
      transform.x -= n.x * depth;
      transform.y -= n.y * depth;
    }
    return true;
  }
  return false;
};

const destroyBrick = (
  gameModel: GameModel,
  board: BrickUpBoard,
  ball: BrickUpBall,
  brickEntity: number
): void => {
  board.brickEntities = board.brickEntities.filter((e) => e !== brickEntity);
  const brickTransform = gameModel.getTypedUnsafe(Transform, brickEntity);
  const brickX = brickTransform.x;
  const brickY = brickTransform.y;
  gameModel.removeEntity(brickEntity);

  // Score goes to the player whose paddle touched the ball last.
  board.score += 10;
  if (ball.lastTouchSide >= 0) {
    const paddleEntity = paddleForSide(gameModel, ball.lastTouchSide);
    if (paddleEntity !== undefined) {
      gameModel.getTypedUnsafe(BrickUpPaddle, paddleEntity).score += 10;
    }
  }

  if (gameModel.rand.number() < DROP_CHANCE) {
    spawnPickup(gameModel, board, brickX, brickY);
  }
};

// One brick interaction per ball per frame. Reinforced bricks need two hits;
// with the PASS upgrade the ball smashes straight through instead of
// bouncing, eating one hp per overlapping frame.
const bounceOnBricks = (gameModel: GameModel, board: BrickUpBoard, ball: BrickUpBall, transform: Transform): void => {
  const lx = transform.x - CENTER_X;
  const ly = transform.y - CENTER_Y;
  for (const brickEntity of board.brickEntities) {
    if (!gameModel.isActive(brickEntity)) {
      continue;
    }
    const brickTransform = gameModel.getTypedUnsafe(Transform, brickEntity);
    const dx = lx - (brickTransform.x - CENTER_X);
    const dy = ly - (brickTransform.y - CENTER_Y);
    const halfW = BRICK_W / 2 + BALL_R;
    const halfH = BRICK_H / 2 + BALL_R;
    if (Math.abs(dx) >= halfW || Math.abs(dy) >= halfH) {
      continue;
    }

    const brick = gameModel.getTypedUnsafe(BrickUpBrick, brickEntity);
    brick.hp -= 1;

    if (board.pierceTimer <= 0) {
      const overlapX = halfW - Math.abs(dx);
      const overlapY = halfH - Math.abs(dy);
      if (overlapX < overlapY) {
        ball.vx = Math.abs(ball.vx) * (dx > 0 ? 1 : -1);
        transform.x += dx > 0 ? overlapX : -overlapX;
      } else {
        ball.vy = Math.abs(ball.vy) * (dy > 0 ? 1 : -1);
        transform.y += dy > 0 ? overlapY : -overlapY;
      }
    }

    if (brick.hp <= 0) {
      destroyBrick(gameModel, board, ball, brickEntity);
    }
    return;
  }
};

// ── Shared game-rule flow (both physics modes) ────────────────────────────────

const exitThroughSide = (gameModel: GameModel, side: number): void => {
  const paddleEntity = paddleForSide(gameModel, side);
  if (paddleEntity !== undefined) {
    const paddle = gameModel.getTypedUnsafe(BrickUpPaddle, paddleEntity);
    paddle.lives -= 1;
    if (paddle.lives <= 0) {
      gameModel.removeEntity(paddleEntity);
    }
  }
};

const applyExits = (gameModel: GameModel, board: BrickUpBoard, exited: number[]): void => {
  if (exited.length === 0) {
    return;
  }
  board.ballEntities = board.ballEntities.filter((e) => !exited.includes(e));
  for (const ballEntity of exited) {
    gameModel.removeEntity(ballEntity);
  }
  if (board.ballEntities.length === 0) {
    board.respawnTimer = RESPAWN_FRAMES;
  }
};

// Rapier mode: the solver owns bounces (walls, paddles, bricks are physical),
// so this path only reads solver results back out of component state and
// applies the game rules: goal-line exits and brick chips from collision
// contacts. Brick hp decays per contact frame; reinforced bricks survive a
// glancing pass.
const runRapier = (gameModel: GameModel, board: BrickUpBoard): void => {
  const speed = BALL_SPEED * (board.slowTimer > 0 ? SLOW_MULT : 1);
  const collisions = gameModel.getTypedUnsafe(Collisions, gameModel.coreEntity);
  const exited: number[] = [];

  for (const ballEntity of board.ballEntities) {
    if (!gameModel.isActive(ballEntity)) {
      continue;
    }
    const ball = gameModel.getTypedUnsafe(BrickUpBall, ballEntity);
    const locomotion = gameModel.getTypedUnsafe(Locomotion, ballEntity);
    const transform = gameModel.getTypedUnsafe(Transform, ballEntity);

    // Keep the solver's pace exact on both peers.
    const mag = Math.sqrt(locomotion.x * locomotion.x + locomotion.y * locomotion.y);
    if (mag > 0) {
      locomotion.x = (locomotion.x / mag) * speed;
      locomotion.y = (locomotion.y / mag) * speed;
    }
    ball.vx = locomotion.x;
    ball.vy = locomotion.y;

    // Goal-line check: wall bands are physical, so only the open gaps can
    // be crossed.
    const lx = transform.x - CENTER_X;
    const ly = transform.y - CENTER_Y;
    for (let side = 0; side < 4; side++) {
      const across = acrossSide(side, lx, ly);
      if (across > FIELD_HALF + BALL_R && Math.abs(alongSide(side, lx, ly)) < GOAL_GAP / 2) {
        exited.push(ballEntity);
        exitThroughSide(gameModel, side);
        break;
      }
    }
    if (exited.includes(ballEntity)) {
      continue;
    }

    const contacts = collisions.collisionMap[ballEntity];
    if (!contacts) {
      continue;
    }
    for (const otherKey of Object.keys(contacts)) {
      const other = +otherKey;
      if (!gameModel.isActive(other)) {
        continue;
      }
      if (gameModel.hasComponent(BrickUpPaddle, other)) {
        ball.lastTouchSide = gameModel.getTypedUnsafe(BrickUpPaddle, other).side;
        continue;
      }
      if (!board.brickEntities.includes(other)) {
        continue;
      }
      const brick = gameModel.getTypedUnsafe(BrickUpBrick, other);
      brick.hp -= 1;
      if (brick.hp <= 0) {
        destroyBrick(gameModel, board, ball, other);
      }
    }
  }

  applyExits(gameModel, board, exited);
};

// ── The system ────────────────────────────────────────────────────────────────

@System(BrickUpBoard)
export class BrickUpBallSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = 200;

  run = (gameModel: GameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(BrickUpBoard, entity);
    if (board.physicsMode === "rapier") {
      runRapier(gameModel, board);
      return;
    }

    const speed = BALL_SPEED * (board.slowTimer > 0 ? SLOW_MULT : 1);
    const exited: number[] = [];

    for (const ballEntity of board.ballEntities) {
      if (!gameModel.isActive(ballEntity)) {
        continue;
      }
      const ball = gameModel.getTypedUnsafe(BrickUpBall, ballEntity);
      const transform = gameModel.getTypedUnsafe(Transform, ballEntity);

      // Re-normalize velocity to the exact target speed every frame so float
      // drift can never accumulate differently on two peers.
      const mag = Math.sqrt(ball.vx * ball.vx + ball.vy * ball.vy);
      if (mag > 0) {
        ball.vx = (ball.vx / mag) * speed;
        ball.vy = (ball.vy / mag) * speed;
      }

      transform.x += ball.vx;
      transform.y += ball.vy;

      const exitedSide = resolveBoundary(ball, transform);
      if (exitedSide >= 0) {
        exited.push(ballEntity);
        exitThroughSide(gameModel, exitedSide);
        continue;
      }

      const bounced = bounceOnPaddles(gameModel, ball, transform);
      if (!bounced) {
        bounceOnBricks(gameModel, board, ball, transform);
      }
    }

    applyExits(gameModel, board, exited);
  };
}

// Keeps the board-level timers ticking, serves new balls and regenerates the
// brick field when a round is cleared. Runs after the ball and pickup
// systems so everything reads this frame's timer values consistently.
@System(BrickUpBoard)
export class BrickUpBoardSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = 400;

  run = (gameModel: GameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(BrickUpBoard, entity);

    // Arena dressing and AI paddles are spawned on the first stepped frame,
    // once the physics mode is settled (rapier arenas enable themselves
    // before stepping) and all human joins have been processed.
    if (gameModel.frame === 1) {
      spawnArenaFrame(gameModel);
      fillAiPaddles(gameModel);
    }

    if (board.slowTimer > 0) {
      board.slowTimer -= 1;
    }
    if (board.pierceTimer > 0) {
      board.pierceTimer -= 1;
    }

    if (board.brickEntities.length === 0) {
      board.round += 1;
      spawnBrickPattern(gameModel, board);
    }

    if (board.respawnTimer > 0) {
      board.respawnTimer -= 1;
      if (board.respawnTimer <= 0) {
        spawnCenterBall(gameModel, board);
      }
    }
  };
}
