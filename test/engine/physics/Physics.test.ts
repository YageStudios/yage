import { test, expect, vi } from "vitest";

// Minimal Rapier stand-in: just the surface PhysicsSystem touches. Defined in
// vi.hoisted so the vi.mock factory below (which is hoisted to module top) can
// reference them.
const h = vi.hoisted(() => {
  class FakeRigidBody {
    constructor(
      public handle: number,
      public userData: any = null
    ) {}
  }

  class FakeCollider {
    parentBody: FakeRigidBody;
    constructor(
      public handle: number,
      parent: FakeRigidBody
    ) {
      this.parentBody = parent;
    }
    parent() {
      return this.parentBody;
    }
  }

  class FakeEventQueue {
    freed = false;
    free() {
      this.freed = true;
    }
  }

  const makeFakeWorld = () => {
    const bodies: FakeRigidBody[] = [];
    const colliders: FakeCollider[] = [];
    let nextHandle = 0;
    const world = {
      timestep: 0,
      bodies: {
        len: () => bodies.length,
        forEach: (cb: (body: FakeRigidBody) => void) => bodies.forEach(cb),
        get: (handle: number) => bodies.find((body) => body.handle === handle),
      },
      colliders: {
        get: (handle: number) => colliders.find((collider) => collider.handle === handle),
      },
      createRigidBody: vi.fn(() => {
        const body = new FakeRigidBody(nextHandle++);
        bodies.push(body);
        return body;
      }),
      createCollider: vi.fn((_desc: any, body: FakeRigidBody) => {
        const collider = new FakeCollider(nextHandle++, body);
        colliders.push(collider);
        return collider;
      }),
      removeRigidBody: vi.fn((body: FakeRigidBody) => {
        const index = bodies.indexOf(body);
        if (index !== -1) bodies.splice(index, 1);
      }),
      removeCollider: vi.fn((collider: FakeCollider) => {
        const index = colliders.indexOf(collider);
        if (index !== -1) colliders.splice(index, 1);
      }),
      forEachCollider: (cb: (collider: FakeCollider) => void) => colliders.forEach(cb),
      takeSnapshot: vi.fn(() => new Uint8Array([1, 2, 3])),
      free: vi.fn(),
      step: vi.fn(),
    };
    return { world, bodies, colliders };
  };

  return { FakeRigidBody, FakeCollider, FakeEventQueue, makeFakeWorld };
});

vi.mock("@dimforge/rapier2d-deterministic-compat", () => {
  const FakeWorld: any = Object.assign(() => h.makeFakeWorld().world, {
    restoreSnapshot: vi.fn(() => h.makeFakeWorld().world),
  });
  return {
    default: {
      World: FakeWorld,
      EventQueue: h.FakeEventQueue,
      RigidBodyDesc: { fixed: () => ({}) },
      ColliderDesc: { cuboid: () => ({}) },
    },
    World: FakeWorld,
    init: vi.fn(),
  };
});

import { PhysicsSystem } from "yage/systems/physics/Physics";
import RAPIER from "@dimforge/rapier2d-deterministic-compat";

const makeSystem = () => new PhysicsSystem(undefined as any);

const makeSaveState = (bodies: Record<number, number>) => ({
  bodies,
  colliders: {},
  data: "snapshot",
  history: [],
});

const stubRestoredWorld = () => {
  const fake = h.makeFakeWorld();
  vi.mocked(RAPIER.World.restoreSnapshot as any).mockReturnValueOnce(fake.world as any);
  return fake;
};

test("restore maps colliders of entity 0", () => {
  const system = makeSystem();
  system.world = (RAPIER.World as any).restoreSnapshot(new Uint8Array());
  system.eventQueue = new h.FakeEventQueue() as any;

  const restored = stubRestoredWorld();
  const body = new h.FakeRigidBody(11, { entity: 0 });
  restored.bodies.push(body);
  restored.colliders.push(new h.FakeCollider(31, body));

  system.restore(makeSaveState({ 11: 0 }) as any);

  expect(system.colliders[0]).toHaveLength(1);
  expect(system.colliderHandles[31]).toBe(0);
});

test("restore clears stale colliderHandles from the previous world", () => {
  const system = makeSystem();
  system.world = (RAPIER.World as any).restoreSnapshot(new Uint8Array());
  system.eventQueue = new h.FakeEventQueue() as any;
  system.colliderHandles = { 999: 5 };

  const restored = stubRestoredWorld();
  const body = new h.FakeRigidBody(1, { entity: 4 });
  restored.bodies.push(body);
  restored.colliders.push(new h.FakeCollider(2, body));

  system.restore(makeSaveState({ 1: 4 }) as any);

  expect(system.colliderHandles).toEqual({ 2: 4 });
});

test("restore replaces the snapshot world without replaying history onto the old world", () => {
  const system = makeSystem();
  const oldFake = h.makeFakeWorld();
  system.world = oldFake.world as any;
  system.eventQueue = new h.FakeEventQueue() as any;

  const restored = stubRestoredWorld();

  system.restore({
    bodies: {},
    colliders: {},
    data: "snapshot",
    history: [["addBody", 0]],
  } as any);

  // The old world is freed, and the history replay never touches it.
  expect(oldFake.world.free).toHaveBeenCalled();
  expect(oldFake.world.createRigidBody).not.toHaveBeenCalled();
  expect(oldFake.world.createCollider).not.toHaveBeenCalled();
  expect(system.world).toBe(restored.world);
});

test("removeRigidBody deletes the entity tracking for a body object", () => {
  const system = makeSystem();
  const fake = h.makeFakeWorld();
  system.world = fake.world as any;

  const body = new h.FakeRigidBody(77, { entity: 7 });
  system.bodies[7] = body as any;

  system.removeRigidBody(body as any);

  expect(system.bodies[7]).toBeUndefined();
  expect(fake.world.removeRigidBody).toHaveBeenCalledWith(body);
  expect(system.history).toContainEqual(["removeBody", 77]);
});
