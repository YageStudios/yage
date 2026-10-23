/** A tiny chunk module for streaming tests: walkers that move at a fixed velocity. */
import { addComponent, addEntity, Component, createWorld, defaultValue, Schema, type, type World } from "minecs";
import type { ChunkModule } from "yage/streaming/host";
import { POSITION_SCALE } from "yage/streaming/protocol";

@Component()
export class TestPos extends Schema {
  @type("float32")
  @defaultValue(0)
  x: number;

  @type("float32")
  @defaultValue(0)
  y: number;
}

@Component()
export class TestVel extends Schema {
  @type("float32")
  @defaultValue(0)
  vx: number;

  @type("float32")
  @defaultValue(0)
  vy: number;
}

@Component()
export class TestGid extends Schema {
  @type("uint32")
  @defaultValue(0)
  id: number;
}

export const SIZE = 100;

export type Walker = { x: number; y: number; vx?: number; vy?: number; gid: number };

/** Builds a module whose chunks are populated from `layout` (keyed "cx,cy"). */
export const testModule = (layout: Record<string, Walker[]>, capacity = 16): ChunkModule => {
  let speedScale = 1;
  return {
    chunkSize: SIZE,
    tickRate: 10,
    warmEvery: 4,
    margin: 5,
    components: [TestPos, TestVel, TestGid],
    position: { component: TestPos, x: "x", y: "y" },
    gid: { component: TestGid, field: "id" },
    generate(_seed, cx, cy) {
      const world = createWorld(capacity) as World;
      for (const walker of layout[`${cx},${cy}`] ?? []) {
        const eid = addEntity(world);
        addComponent(world, TestPos, eid);
        addComponent(world, TestVel, eid);
        addComponent(world, TestGid, eid);
        world(TestPos).store.x[eid] = walker.x;
        world(TestPos).store.y[eid] = walker.y;
        world(TestVel).store.vx[eid] = walker.vx ?? 0;
        world(TestVel).store.vy[eid] = walker.vy ?? 0;
        world(TestGid).store.id[eid] = walker.gid;
      }
      return world;
    },
    step(world, ctx) {
      const pos = world(TestPos).store;
      const vel = world(TestVel).store;
      for (const eid of world.entitySparseSet.dense) {
        pos.x[eid] += vel.vx[eid] * ctx.ticks * speedScale;
        pos.y[eid] += vel.vy[eid] * ctx.ticks * speedScale;
      }
    },
    render(world, snapshot) {
      const pos = world(TestPos).store;
      const gid = world(TestGid).store;
      for (const eid of world.entitySparseSet.dense) {
        snapshot.x[eid] = Math.round(pos.x[eid] * POSITION_SCALE);
        snapshot.y[eid] = Math.round(pos.y[eid] * POSITION_SCALE);
        snapshot.gid[eid] = gid.id[eid];
        snapshot.sprite[eid] = 0;
        snapshot.tint[eid] = 1;
      }
    },
    stats(world) {
      return new Uint8Array([world.entitySparseSet.dense.length]);
    },
    configure(bytes) {
      speedScale = bytes[0];
    },
    input(world, eid, bytes) {
      world(TestVel).store.vx[eid] = (bytes[0] as number) - 128;
    },
    describe() {
      return 7;
    },
  };
};
