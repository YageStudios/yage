import { Component, Schema, defaultValue, type } from "minecs";

// All sim state lives in these components: four paddles (one per player,
// each defending one side of a square arena), balls with explicit velocity,
// bricks, upgrade pickups and one board that ties it together.

@Component()
export class BrickUpBoard extends Schema {
  // "manual" integrates velocities and resolves collisions in pure TS;
  // "rapier" hands movement and bounces to the Rapier physics world and
  // applies game rules to the solver's results. The mode rides with the
  // serialized state, so snapshots restore into the same physics backend.
  @type("string")
  @defaultValue("manual")
  physicsMode: string;

  @type("number")
  @defaultValue(0)
  score: number;

  @type("number")
  @defaultValue(1)
  round: number;

  // Frames until the next ball serves from the center; 1 at boot so the
  // first ball serves on the first stepped frame.
  @type("number")
  @defaultValue(1)
  respawnTimer: number;

  @type("number")
  @defaultValue(0)
  slowTimer: number;

  @type("number")
  @defaultValue(0)
  pierceTimer: number;

  @type("number")
  @defaultValue(0)
  upgradesApplied: number;

  @type(["number"])
  @defaultValue([])
  ballEntities: number[];

  @type(["number"])
  @defaultValue([])
  brickEntities: number[];

  @type(["number"])
  @defaultValue([])
  pickupEntities: number[];
}

@Component()
export class BrickUpPaddle extends Schema {
  // 0 = bottom, 1 = top, 2 = left, 3 = right
  @type("number")
  @defaultValue(0)
  side: number;

  @type("string")
  @defaultValue("")
  ownerPid: string;

  @type("number")
  @defaultValue(3)
  lives: number;

  @type("number")
  @defaultValue(0)
  score: number;

  @type("number")
  @defaultValue(0)
  wideTimer: number;

  @type("number")
  @defaultValue(0)
  reversedTimer: number;
}

@Component()
export class BrickUpBall extends Schema {
  @type("number")
  @defaultValue(0)
  vx: number;

  @type("number")
  @defaultValue(0)
  vy: number;

  // Side of the paddle that last touched the ball; brick score is credited
  // to that player.
  @type("number")
  @defaultValue(-1)
  lastTouchSide: number;
}

@Component()
export class BrickUpBrick extends Schema {
  @type("number")
  @defaultValue(1)
  hp: number;

  @type("number")
  @defaultValue(0)
  col: number;

  @type("number")
  @defaultValue(0)
  row: number;
}

@Component()
export class BrickUpPickup extends Schema {
  @type("string")
  @defaultValue("WIDE")
  pickupType: string;

  @type("number")
  @defaultValue(0)
  vx: number;

  @type("number")
  @defaultValue(0)
  vy: number;
}
