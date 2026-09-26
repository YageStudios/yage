import { beforeAll, expect, test } from "vitest";
import RAPIER from "@dimforge/rapier2d-deterministic-compat";
import { PhysicsSystem } from "yage/systems/physics/Physics";
import { MapSystem } from "yage/systems/map/Map";
import { Physics } from "yage/schemas/physics/Physics";
import { initRapier, makeTestGame, setupRealPhysicsGlobals } from "../../helpers/realPhysics";

setupRealPhysicsGlobals();

beforeAll(async () => {
  await initRapier();
});

const makeGameWithMapSystem = () => {
  const gameModel = makeTestGame("map-cleanup");
  gameModel.addComponent(Physics, gameModel.coreEntity, { gravityX: 0, gravityY: 0 });
  gameModel.getSystem(PhysicsSystem).init(gameModel, gameModel.coreEntity);
  return { gameModel, physicsSystem: gameModel.getSystem(PhysicsSystem), mapSystem: gameModel.getSystem(MapSystem) };
};

const seedMapCache = (mapSystem: MapSystem, physicsSystem: PhysicsSystem, entity: number) => {
  const body = physicsSystem.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(1, 2));
  mapSystem.collisionBodies[entity] = { world: physicsSystem.world, bodies: [body] };
  mapSystem.pathfinders[entity] = {} as (typeof mapSystem.pathfinders)[number];
  return body;
};

test("cache release removes cached bodies from the live physics world", () => {
  const { gameModel, physicsSystem, mapSystem } = makeGameWithMapSystem();
  seedMapCache(mapSystem, physicsSystem, 7);
  expect(physicsSystem.world.bodies.len()).toBe(1);

  mapSystem.cleanup(gameModel, 7);

  expect(physicsSystem.world.bodies.len()).toBe(0);
  expect(mapSystem.collisionBodies[7]).toBeUndefined();
  expect(mapSystem.pathfinders[7]).toBeUndefined();
});

test("cache release drops stale bodies from a freed world without touching the live one", () => {
  const { gameModel, physicsSystem, mapSystem } = makeGameWithMapSystem();
  seedMapCache(mapSystem, physicsSystem, 7);

  // Simulates what PhysicsSystem.restore does: the old world is freed and
  // replaced, leaving MapSystem's cache pointing at freed memory.
  physicsSystem.world = new RAPIER.World({ x: 0, y: 0 });
  const liveBody = physicsSystem.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(3, 4));

  expect(() => mapSystem.cleanup(gameModel, 7)).not.toThrow();
  expect(physicsSystem.world.bodies.len()).toBe(1);
  expect(mapSystem.collisionBodies[7]).toBeUndefined();
  expect(liveBody.translation().x).toBe(3);
});

test("cache release is idempotent", () => {
  const { gameModel, physicsSystem, mapSystem } = makeGameWithMapSystem();
  seedMapCache(mapSystem, physicsSystem, 7);

  mapSystem.cleanup(gameModel, 7);
  mapSystem.cleanup(gameModel, 7);

  expect(physicsSystem.world.bodies.len()).toBe(0);
  expect(mapSystem.collisionBodies[7]).toBeUndefined();
  expect(mapSystem.pathfinders[7]).toBeUndefined();
});
