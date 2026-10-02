import { cos, sin } from "yage/utils/deterministicMath";
import { Component, defaultValue, DrawSystemImpl, Schema, System, SystemImpl, type } from "minecs";
import type { GameModel, ReadOnlyGameModel } from "yage/game/GameModel";
import { Button, Column, CommandQueue, Model, Panel, Text, UIFinal, when } from "yage/ui/final";
import type { Child } from "yage/ui/final";
import { PlayerInput } from "yage/schemas/core/PlayerInput";
import { keyDown } from "yage/utils/keys";
import { EntityFactory } from "yage/entity/EntityFactory";
import { Transform } from "yage/schemas/entity/Transform";
import { canPresentUI } from "../../shared/uiFinal";

// ── Constants ─────────────────────────────────────────────────────────────────

const FIELD_W = 800;
const FIELD_H = 600;
const FIELD_OFFSET_X = (1920 - FIELD_W) / 2;
const FIELD_OFFSET_Y = (1080 - FIELD_H) / 2;
const PADDLE_W = 12;
const PADDLE_H = 80;
const BALL_SIZE = 12;
const PADDLE_SPEED = 6;
const WINNING_SCORE = 7;
const PADDLE_OFFSET = 30;

// ── Component ─────────────────────────────────────────────────────────────────

@Component()
export class PongBoard extends Schema {
  @type("number")
  @defaultValue(0)
  leftScore: number;

  @type("number")
  @defaultValue(0)
  rightScore: number;

  @type("string")
  @defaultValue("PLAYING")
  status: string;

  @type("float32")
  @defaultValue(4)
  ballVx: number;

  @type("float32")
  @defaultValue(2)
  ballVy: number;

  @type("float32")
  @defaultValue(400)
  ballX: number;

  @type("float32")
  @defaultValue(300)
  ballY: number;

  @type("float32")
  @defaultValue(250)
  leftPaddleY: number;

  @type("float32")
  @defaultValue(250)
  rightPaddleY: number;

  @type("number")
  @defaultValue(-1)
  leftPaddleEntity: number;

  @type("number")
  @defaultValue(-1)
  rightPaddleEntity: number;

  @type("number")
  @defaultValue(-1)
  ballEntity: number;

  @type(["number"])
  @defaultValue([])
  netEntities: number[];
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function resetBall(board: PongBoard, gameModel: GameModel): void {
  board.ballX = FIELD_W / 2;
  board.ballY = FIELD_H / 2;
  const dir = gameModel.rand.int(0, 1) === 0 ? 1 : -1;
  const angle = gameModel.rand.float(-0.5, 0.5);
  const speed = 4;
  board.ballVx = speed * dir;
  board.ballVy = speed * angle;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

// ── Init System ───────────────────────────────────────────────────────────────

@System(PongBoard)
export class PongInitSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = -100;

  init = (gameModel: GameModel, entity: number) => {
    const board = gameModel.getTypedUnsafe(PongBoard, entity);
    resetBall(board, gameModel);
    board.leftPaddleY = (FIELD_H - PADDLE_H) / 2;
    board.rightPaddleY = (FIELD_H - PADDLE_H) / 2;
    board.leftScore = 0;
    board.rightScore = 0;
    board.status = "PLAYING";

    // Spawn left paddle entity
    const leftPaddle = EntityFactory.getInstance().generateEntity(gameModel, "PongPaddle");
    const leftT = gameModel.getTypedUnsafe(Transform, leftPaddle);
    leftT.x = FIELD_OFFSET_X + PADDLE_OFFSET + PADDLE_W / 2;
    leftT.y = FIELD_OFFSET_Y + board.leftPaddleY + PADDLE_H / 2;
    board.leftPaddleEntity = leftPaddle;

    // Spawn right paddle entity
    const rightPaddle = EntityFactory.getInstance().generateEntity(gameModel, "PongPaddle");
    const rightT = gameModel.getTypedUnsafe(Transform, rightPaddle);
    rightT.x = FIELD_OFFSET_X + FIELD_W - PADDLE_OFFSET - PADDLE_W / 2;
    rightT.y = FIELD_OFFSET_Y + board.rightPaddleY + PADDLE_H / 2;
    board.rightPaddleEntity = rightPaddle;

    // Spawn ball entity
    const ball = EntityFactory.getInstance().generateEntity(gameModel, "PongBall");
    const ballT = gameModel.getTypedUnsafe(Transform, ball);
    ballT.x = FIELD_OFFSET_X + board.ballX + BALL_SIZE / 2;
    ballT.y = FIELD_OFFSET_Y + board.ballY + BALL_SIZE / 2;
    board.ballEntity = ball;

    // Spawn center net dashes
    const netEntities: number[] = [];
    for (let y = 0; y < FIELD_H; y += 20) {
      if (Math.floor(y / 20) % 2 !== 0) continue;
      const net = EntityFactory.getInstance().generateEntity(gameModel, "PongNet");
      const netT = gameModel.getTypedUnsafe(Transform, net);
      netT.x = FIELD_OFFSET_X + FIELD_W / 2;
      netT.y = FIELD_OFFSET_Y + y + 5;
      netEntities.push(net);
    }
    board.netEntities = netEntities;
  };
}

// ── Game Logic System ─────────────────────────────────────────────────────────

@System(PongBoard)
export class PongSystem extends SystemImpl<GameModel> {
  static category = 0;
  static depth = 0;

  run = (gameModel: GameModel, entity: number) => {
    // HUD restart commands are applied here — the authoritative gameplay input point.
    gameModel.getSystem(PongUISystem)?.commands.drain(command => {
      if (command.type !== "restart") return;
      const board = gameModel.getTypedUnsafe(PongBoard, entity);
      board.leftScore = 0;
      board.rightScore = 0;
      board.status = "PLAYING";
      resetBall(board, gameModel);
    });

    const board = gameModel.getTypedUnsafe(PongBoard, entity);
    if (board.status !== "PLAYING") return;

    // Read input from both players
    const playerEntities = gameModel.getComponentActives("PlayerInput");

    for (let i = 0; i < playerEntities.length; i++) {
      const pi = gameModel.getTypedUnsafe(PlayerInput, playerEntities[i]);
      if (!pi.keyMap) continue;

      if (i === 0) {
        if (keyDown(["w", "up"], pi.keyMap)) {
          board.leftPaddleY -= PADDLE_SPEED;
        }
        if (keyDown(["s", "down"], pi.keyMap)) {
          board.leftPaddleY += PADDLE_SPEED;
        }
      } else if (i === 1) {
        if (keyDown(["w", "up"], pi.keyMap)) {
          board.rightPaddleY -= PADDLE_SPEED;
        }
        if (keyDown(["s", "down"], pi.keyMap)) {
          board.rightPaddleY += PADDLE_SPEED;
        }
      }
    }

    // If only 1 player, AI controls right paddle
    if (playerEntities.length < 2) {
      const targetY = board.ballY - PADDLE_H / 2;
      const diff = targetY - board.rightPaddleY;
      board.rightPaddleY += clamp(diff, -PADDLE_SPEED * 0.7, PADDLE_SPEED * 0.7);
    }

    // Clamp paddles
    board.leftPaddleY = clamp(board.leftPaddleY, 0, FIELD_H - PADDLE_H);
    board.rightPaddleY = clamp(board.rightPaddleY, 0, FIELD_H - PADDLE_H);

    // Move ball
    board.ballX += board.ballVx;
    board.ballY += board.ballVy;

    // Top/bottom bounce
    if (board.ballY <= 0) {
      board.ballY = 0;
      board.ballVy = Math.abs(board.ballVy);
    }
    if (board.ballY >= FIELD_H - BALL_SIZE) {
      board.ballY = FIELD_H - BALL_SIZE;
      board.ballVy = -Math.abs(board.ballVy);
    }

    // Left paddle collision
    if (
      board.ballX <= PADDLE_OFFSET + PADDLE_W &&
      board.ballX >= PADDLE_OFFSET &&
      board.ballY + BALL_SIZE >= board.leftPaddleY &&
      board.ballY <= board.leftPaddleY + PADDLE_H
    ) {
      board.ballX = PADDLE_OFFSET + PADDLE_W;
      const hitPos = (board.ballY + BALL_SIZE / 2 - board.leftPaddleY) / PADDLE_H;
      const angle = (hitPos - 0.5) * 2.5;
      const speed = Math.sqrt(board.ballVx * board.ballVx + board.ballVy * board.ballVy) + 0.15;
      board.ballVx = Math.abs(speed * cos(angle));
      board.ballVy = speed * sin(angle);
    }

    // Right paddle collision
    if (
      board.ballX + BALL_SIZE >= FIELD_W - PADDLE_OFFSET - PADDLE_W &&
      board.ballX + BALL_SIZE <= FIELD_W - PADDLE_OFFSET &&
      board.ballY + BALL_SIZE >= board.rightPaddleY &&
      board.ballY <= board.rightPaddleY + PADDLE_H
    ) {
      board.ballX = FIELD_W - PADDLE_OFFSET - PADDLE_W - BALL_SIZE;
      const hitPos = (board.ballY + BALL_SIZE / 2 - board.rightPaddleY) / PADDLE_H;
      const angle = (hitPos - 0.5) * 2.5;
      const speed = Math.sqrt(board.ballVx * board.ballVx + board.ballVy * board.ballVy) + 0.15;
      board.ballVx = -Math.abs(speed * cos(angle));
      board.ballVy = speed * sin(angle);
    }

    // Scoring
    if (board.ballX < 0) {
      board.rightScore++;
      if (board.rightScore >= WINNING_SCORE) {
        board.status = "RIGHT_WINS";
      } else {
        resetBall(board, gameModel);
      }
    }
    if (board.ballX > FIELD_W) {
      board.leftScore++;
      if (board.leftScore >= WINNING_SCORE) {
        board.status = "LEFT_WINS";
      } else {
        resetBall(board, gameModel);
      }
    }

    // Sync entity positions
    if (board.leftPaddleEntity !== -1) {
      const t = gameModel.getTypedUnsafe(Transform, board.leftPaddleEntity);
      t.y = FIELD_OFFSET_Y + board.leftPaddleY + PADDLE_H / 2;
    }
    if (board.rightPaddleEntity !== -1) {
      const t = gameModel.getTypedUnsafe(Transform, board.rightPaddleEntity);
      t.y = FIELD_OFFSET_Y + board.rightPaddleY + PADDLE_H / 2;
    }
    if (board.ballEntity !== -1) {
      const t = gameModel.getTypedUnsafe(Transform, board.ballEntity);
      t.x = FIELD_OFFSET_X + board.ballX + BALL_SIZE / 2;
      t.y = FIELD_OFFSET_Y + board.ballY + BALL_SIZE / 2;
    }
  };
}

// ── Presentation projection ───────────────────────────────────────────────────

function statusMessage(board: PongBoard): string {
  if (board.status === "LEFT_WINS") return "Left Player Wins!";
  if (board.status === "RIGHT_WINS") return "Right Player Wins!";
  return `${board.leftScore}  -  ${board.rightScore}`;
}

interface PongHudState {
  statusMessage: string;
  showGameOver: boolean;
}

// ── UI Final HUD ──────────────────────────────────────────────────────────────

@System(PongBoard)
export class PongUISystem extends DrawSystemImpl<ReadOnlyGameModel> {
  /** Commands from the HUD; drained by PongSystem at the gameplay input boundary. */
  readonly commands = new CommandQueue();
  private ui?: UIFinal;
  private state?: Model<PongHudState>;

  init = (_gameModel: ReadOnlyGameModel, _entity: number) => {
    // Headless runs (unit tests) have no real DOM; the HUD is presentation-only.
    if (!canPresentUI() || this.ui) return;
    const ui = (this.ui = new UIFinal());
    const state = (this.state = new Model<PongHudState>({ statusMessage: "", showGameOver: false }));
    ui.scope.add(() => { this.state = undefined; state.dispose(); });
    ui.mount(this.hud(state));
  };

  private hud(state: Model<PongHudState>): Child {
    return [
      Text(() => state.get<string>("statusMessage"), {
        id: "scoreText",
        style: {
          position: "absolute", top: 20, left: "50%", transform: "translateX(-50%)",
          fontSize: 48, color: "#ffffff", textAlign: "center", fontFamily: "monospace",
          textShadow: "0 0 4px #000000",
        },
      }),
      Text("P1: W/S  |  P2: ↑/↓  (single player: AI opponent)", {
        style: {
          position: "absolute", bottom: 20, left: "50%", transform: "translateX(-50%)",
          fontSize: 14, color: "#aaaaaa", textAlign: "center",
        },
      }),
      when(() => state.get<boolean>("showGameOver"), () =>
        Panel({
          id: "gameOver",
          style: { position: "absolute", inset: 0, display: "grid", placeItems: "center" },
        },
          Column({ style: { alignItems: "center", gap: 24 } },
            Text(() => state.get<string>("statusMessage"), {
              id: "gameOverText",
              style: {
                fontSize: 48, color: "#44ff44", textAlign: "center",
                textShadow: "0 0 20px #00ff00",
              },
            }),
            Button({
              id: "restart",
              autoFocus: true,
              style: {
                minWidth: 220, minHeight: 64, fontSize: 28,
                backgroundColor: "#4CAF50", color: "#ffffff", borderRadius: 8,
              },
              on: { activate: event => { this.commands.enqueue(event.player, "restart"); } },
            }, "Play Again")))),
    ];
  }

  run = (gameModel: ReadOnlyGameModel, entity: number) => {
    if (!this.state) return;
    const board = gameModel.getTypedUnsafe(PongBoard, entity);
    this.state.set("statusMessage", statusMessage(board));
    this.state.set("showGameOver", board.status !== "PLAYING");
  };

  cleanup = () => {
    this.ui?.dispose();
    this.ui = undefined;
  };
}