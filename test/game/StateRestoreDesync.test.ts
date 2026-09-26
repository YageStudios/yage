import { beforeAll, expect, test } from "vitest";
import { cloneDeep } from "lodash";
import { deleteWorld, deserializeWorld, serializeWorld, SerialMode } from "minecs";
import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import { GameModel } from "yage/game/GameModel";
import { Physics } from "yage/schemas/physics/Physics";
import { PhysicsSystem } from "yage/systems/physics/Physics";
import { Transform } from "yage/schemas/entity/Transform";
import { RigidBox } from "yage/schemas/physics/RigidBox";
import { RigidCircle } from "yage/schemas/physics/RigidCircle";
import { Locomotion } from "yage/schemas/entity/Locomotion";
import { initRapier, makeTestGame, setupRealPhysicsGlobals } from "../helpers/realPhysics";

setupRealPhysicsGlobals();

// Real Rapier WASM on purpose: these guarantees only exist with real physics
// integration, the mocked-Rapier suites cannot see it.
beforeAll(async () => {
  await initRapier();
});

// A box driven by nothing but gravity (velocity owned by the physics step,
// mirrored into Locomotion by the resolver via velocityLock) next to a circle
// whose velocity is imposed from Locomotion every frame.
const spawnFallingBoxAndMovingCircle = (gameModel: GameModel) => {
  gameModel.addComponent(Physics, gameModel.coreEntity, { gravityX: 0, gravityY: -600 });
  // Normal boot reaches getEngine through the map load; there is no map here.
  const physicsSystem = gameModel.getSystem(PhysicsSystem);
  physicsSystem.init(gameModel, gameModel.coreEntity);

  const box = gameModel.addEntity();
  gameModel.addComponent(Transform, box, { x: 100, y: 0 });
  gameModel.addComponent(RigidBox, box, { width: 10, height: 10, mass: 1 });

  const circle = gameModel.addEntity();
  gameModel.addComponent(Transform, circle, { x: -100, y: 0 });
  gameModel.addComponent(RigidCircle, circle, { radius: 5, mass: 1 });
  gameModel.addComponent(Locomotion, circle, { x: 1, y: 0 });

  return { box, circle };
};

const stepFrames = (gameModel: GameModel, frames: number) => {
  for (let i = 0; i < frames; i++) {
    gameModel.step();
  }
};

const componentSnapshot = (gameModel: GameModel) => JSON.stringify(serializeWorld(SerialMode.JSON, gameModel));

const transformOf = (gameModel: GameModel, entity: number) => {
  const store = gameModel(Transform).store;
  return { x: store.x[entity], y: store.y[entity] };
};

const SNAPSHOT_FRAME = 60;
const RUN_FRAMES = 120;

test("two same-seed game models stepped in lockstep stay bit-identical", () => {
  const first = makeTestGame("desync-proof");
  const second = makeTestGame("desync-proof");
  spawnFallingBoxAndMovingCircle(first);
  spawnFallingBoxAndMovingCircle(second);

  stepFrames(first, RUN_FRAMES);
  stepFrames(second, RUN_FRAMES);

  expect(componentSnapshot(second)).toBe(componentSnapshot(first));
});

test("blob restore (the current handoff) does not desync", async () => {
  const source = makeTestGame("desync-proof");
  const { box } = spawnFallingBoxAndMovingCircle(source);
  stepFrames(source, SNAPSHOT_FRAME);

  // The state that used to live only inside Rapier: a falling box with no
  // driver. Its velocity must be mirrored into Locomotion so the components
  // alone carry it.
  const boxBody = source.getSystem(PhysicsSystem).getRigidBody(box);
  if (!boxBody) {
    throw new Error("box rigid body missing");
  }
  expect(boxBody.linvel().y).toBeLessThan(-1);
  const boxLocomotion = source.getTypedUnsafe(Locomotion, box);
  expect(boxLocomotion.x !== 0 || boxLocomotion.y !== 0).toBe(true);

  const restored = makeTestGame("desync-proof");
  await restored.deserializeState(cloneDeep(source.serializeState()));

  stepFrames(source, RUN_FRAMES);
  stepFrames(restored, RUN_FRAMES);

  expect(restored.frame).toBe(source.frame);
  expect(componentSnapshot(restored)).toBe(componentSnapshot(source));
});

test("component-only rebuild resumes the falling box and the circle bit-exact", async () => {
  const source = makeTestGame("desync-proof");
  const { box, circle } = spawnFallingBoxAndMovingCircle(source);
  stepFrames(source, SNAPSHOT_FRAME);
  const state = cloneDeep(source.serializeState());

  // The cleanup+rebuild restore: components only, no Rapier blob. Mirrors
  // GameModel.deserializeState minus the physics restore — including the init
  // call that wires coreEntity before getEngine; without it gravity reads as
  // undefined and the world NaNs every body on its first step.
  const rebuilt = makeTestGame("desync-proof");
  rebuilt.coreEntity = state.core;
  rebuilt.timeElapsed = state.timeElapsed;
  rebuilt.frame = state.frame;
  deleteWorld(rebuilt);
  deserializeWorld(state.world, rebuilt);
  rebuilt.getSystem(PhysicsSystem).init(rebuilt, rebuilt.coreEntity);

  stepFrames(source, RUN_FRAMES);
  stepFrames(rebuilt, RUN_FRAMES);

  // Box velocity is physics-owned and mirrored into Locomotion via
  // velocityLock; the rebuilt box must resume exactly, not restart at rest.
  const sourceBox = transformOf(source, box);
  const rebuiltBox = transformOf(rebuilt, box);
  expect(rebuiltBox.x).toBe(sourceBox.x);
  expect(rebuiltBox.y).toBe(sourceBox.y);

  const sourceCircle = transformOf(source, circle);
  const rebuiltCircle = transformOf(rebuilt, circle);
  expect(rebuiltCircle.x).toBe(sourceCircle.x);
  expect(rebuiltCircle.y).toBe(sourceCircle.y);

  expect(componentSnapshot(rebuilt)).toBe(componentSnapshot(source));
});
