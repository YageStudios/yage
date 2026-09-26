import { beforeAll, expect, test } from "vitest";
import { GameModel } from "yage/game/GameModel";
import { Physics } from "yage/schemas/physics/Physics";
import { PhysicsSystem } from "yage/systems/physics/Physics";
import { Transform } from "yage/schemas/entity/Transform";
import { RigidCircle } from "yage/schemas/physics/RigidCircle";
import { initRapier, makeTestGame, setupRealPhysicsGlobals } from "../../helpers/realPhysics";

setupRealPhysicsGlobals();

// Real Rapier WASM on purpose: the NaN handoff into the physics solver only
// exists with real integration, the mocked-Rapier suites cannot see it.
beforeAll(async () => {
  await initRapier();
});

// Nothing guarantees Locomotion on a RigidCircle entity: the factory's
// `dependencies` list is an init-ordering hint, not an auto-add, and the
// resolver already guards its own Locomotion reads. runAll must guard too,
// or an undefined store read turns into NaN linvel in the physics world.
test("a RigidCircle without Locomotion does not poison the world with NaN", () => {
  const gameModel = makeTestGame("circle-nan");
  gameModel.addComponent(Physics, gameModel.coreEntity, { gravityX: 0, gravityY: -600 });
  gameModel.getSystem(PhysicsSystem).init(gameModel, gameModel.coreEntity);

  const circle = gameModel.addEntity();
  gameModel.addComponent(Transform, circle, { x: 0, y: 0 });
  gameModel.addComponent(RigidCircle, circle, { radius: 5, mass: 1 });

  gameModel.step();
  const body = gameModel.getSystem(PhysicsSystem).getRigidBody(circle);
  if (!body) {
    throw new Error("rigid body missing");
  }
  const velocity = body.linvel();
  expect(Number.isFinite(velocity.x)).toBe(true);
  expect(Number.isFinite(velocity.y)).toBe(true);

  // NaN velocity integrates into NaN transforms on the next physics step.
  gameModel.step();
  expect(Number.isFinite(gameModel(Transform).store.x[circle])).toBe(true);
  expect(Number.isFinite(gameModel(Transform).store.y[circle])).toBe(true);
});
