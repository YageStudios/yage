import { describe, expect, test } from "vitest";
import { addComponent, addEntity } from "minecs";
import { ChunkHost, type ChunkModule } from "yage/streaming/host";
import { leanWorldType } from "yage/world/lean";
import {
  decodeMessage,
  encodeConfig,
  encodeGenerate,
  encodeHello,
  encodeInput,
  encodeLoad,
  encodeRoute,
  encodeTier,
  encodeTrack,
  encodeTransfer,
  encodeUnload,
  EMPTY_SLOT,
  NO_HOST,
  Op,
  POSITION_SCALE,
  Tier,
  type Message,
} from "yage/streaming/protocol";
import { memoryTransportPair } from "yage/streaming/transport";
import { SIZE, testModule, TestGid, TestPos, TestVel, type Walker } from "./fixture";

const connect = (host: ChunkHost) => {
  const [client, hostSide] = memoryTransportPair();
  host.attach(hostSide);
  const messages: Message[] = [];
  client.onMessage((bytes) => messages.push(decodeMessage(bytes)));
  client.send(encodeHello());
  return {
    send: (bytes: Uint8Array) => client.send(bytes),
    messages,
    last<T extends Message["op"]>(op: T) {
      return [...messages].reverse().find((m) => m.op === op) as Extract<Message, { op: T }> | undefined;
    },
    all<T extends Message["op"]>(op: T) {
      return messages.filter((m) => m.op === op) as Extract<Message, { op: T }>[];
    },
  };
};

const gidsIn = (host: ChunkHost, cx: number, cy: number) => {
  const chunk = [...host.chunks.values()].find((c) => c.cx === cx && c.cy === cy)!;
  return chunk.world.entitySparseSet.dense.map((eid: number) => chunk.world(TestGid).store.id[eid]).sort();
};

const positionOf = (host: ChunkHost, gid: number) => {
  for (const chunk of host.chunks.values()) {
    for (const eid of chunk.world.entitySparseSet.dense) {
      if (chunk.world(TestGid).store.id[eid] === gid) {
        return { cx: chunk.cx, cy: chunk.cy, x: chunk.world(TestPos).store.x[eid], y: chunk.world(TestPos).store.y[eid] };
      }
    }
  }
  return null;
};

describe("ChunkHost", () => {
  test("generates a chunk, reports Ready, and snapshots it while hot", () => {
    const host = new ChunkHost(testModule({ "0,0": [{ x: 10, y: 20, vx: 1, gid: 41 }] }));
    const client = connect(host);
    client.send(encodeGenerate(0, 0, 1));
    expect(client.last(Op.Ready)).toMatchObject({ cx: 0, cy: 0, population: 1 });

    client.send(encodeTier(0, 0, Tier.Hot, 1));
    host.tick();
    const snapshot = client.last(Op.Snapshot)!.snapshot;
    expect(snapshot).toMatchObject({ cx: 0, cy: 0, tick: 0, count: 1 });
    expect(snapshot.x[0]).toBe(11 * POSITION_SCALE);
    expect(snapshot.y[0]).toBe(20 * POSITION_SCALE);
    expect(snapshot.gid[0]).toBe(41);
    expect(client.last(Op.Stats)!.entries).toEqual([{ space: 0, cx: 0, cy: 0, bytes: new Uint8Array([1]) }]);
  });

  test("steps warm chunks every warmEvery ticks with the whole interval, and sends no snapshots", () => {
    const host = new ChunkHost(testModule({ "0,0": [{ x: 10, y: 10, vx: 1, gid: 1 }] }));
    const client = connect(host);
    client.send(encodeGenerate(0, 0, 1));
    for (let i = 0; i < 8; i++) host.tick();
    expect(positionOf(host, 1)!.x).toBe(18);
    expect(client.all(Op.Stats).filter((s) => s.entries.length).length).toBe(2);
    expect(client.all(Op.Snapshot)).toHaveLength(0);
  });

  test("empty slots are marked so the client can skip them", () => {
    const walkers: Walker[] = [
      { x: 98, y: 50, vx: 10, gid: 1 },
      { x: 50, y: 50, gid: 2 },
    ];
    const host = new ChunkHost(testModule({ "0,0": walkers }));
    const client = connect(host);
    client.send(encodeGenerate(0, 0, 1));
    client.send(encodeTier(0, 0, Tier.Hot, 1));
    host.tick(); // gid 1 leaves into an unloaded chunk and bounces
    host.tick();
    const snapshot = client.last(Op.Snapshot)!.snapshot;
    expect(snapshot.count).toBe(2);
    expect([...snapshot.tint]).not.toContain(EMPTY_SLOT);
  });

  test("hands an entity to a neighbouring chunk on the same host, shifting its position", () => {
    const host = new ChunkHost(
      testModule({
        "0,0": [{ x: 98, y: 50, vx: 10, gid: 7 }],
        "1,0": [],
      })
    );
    const client = connect(host);
    client.send(encodeGenerate(0, 0, 1));
    client.send(encodeGenerate(1, 0, 1));
    client.send(encodeTier(0, 0, Tier.Hot, 1));
    client.send(encodeTier(1, 0, Tier.Hot, 1));
    host.tick();
    expect(positionOf(host, 7)).toEqual({ cx: 1, cy: 0, x: 8, y: 50 });
    expect(gidsIn(host, 0, 0)).toEqual([]);
  });

  test("with deferred generates, runs hot chunks first, ticks between, and generates a queued chunk an entity walks into", () => {
    const generated: string[] = [];
    const module = testModule({ "0,0": [], "1,0": [{ x: 1, y: 50, vx: -10, gid: 7 }], "2,0": [] });
    const generate = module.generate.bind(module);
    module.generate = (seed, cx, cy, space) => {
      generated.push(`${cx},${cy}`);
      return generate(seed, cx, cy, space);
    };
    module.staticData = (_world, cx, cy) => new Uint8Array([cx, cy]);
    const host = new ChunkHost(module, { deferGenerates: true });
    const client = connect(host);
    client.send(encodeGenerate(0, 0, 1));
    client.send(encodeGenerate(1, 0, 1));
    client.send(encodeGenerate(2, 0, 1));
    client.send(encodeTier(1, 0, Tier.Hot, 1));
    expect(generated).toEqual([]);
    expect(client.all(Op.Ready)).toEqual([]);
    expect(host.generateNext()).toBe(2);
    expect(generated).toEqual(["1,0"]);
    expect(client.last(Op.Ready)).toMatchObject({ cx: 1, cy: 0 });
    // Watched hot before it existed: its static data goes out once it does.
    expect(client.all(Op.Static).map((m) => [m.cx, m.cy])).toEqual([[1, 0]]);
    host.tick();
    expect(generated).toEqual(["1,0", "0,0"]);
    expect(positionOf(host, 7)).toMatchObject({ cx: 0, cy: 0 });
    expect(host.generateNext()).toBe(0);
    expect(generated).toEqual(["1,0", "0,0", "2,0"]);
    host.stop();
  });

  test("an entity inside the overlap margin stays in its chunk", () => {
    const host = new ChunkHost(testModule({ "0,0": [{ x: 99, y: 50, vx: 3, gid: 7 }], "1,0": [] }));
    const client = connect(host);
    client.send(encodeGenerate(0, 0, 1));
    client.send(encodeGenerate(1, 0, 1));
    client.send(encodeTier(0, 0, Tier.Hot, 1));
    host.tick();
    expect(positionOf(host, 7)).toEqual({ cx: 0, cy: 0, x: 102, y: 50 });
  });

  test("bounces an entity back inside when the neighbour is not loaded", () => {
    const host = new ChunkHost(testModule({ "0,0": [{ x: 98, y: 50, vx: 10, gid: 7 }] }));
    const client = connect(host);
    client.send(encodeGenerate(0, 0, 1));
    client.send(encodeTier(0, 0, Tier.Hot, 1));
    host.tick();
    const position = positionOf(host, 7)!;
    expect(position.cx).toBe(0);
    expect(position.x).toBeLessThan(SIZE);
  });

  test("bounces an entity back when the neighbour is full", () => {
    const full: Walker[] = [1, 2].map((gid) => ({ x: 50, y: 50, gid: 100 + gid }));
    const host = new ChunkHost(testModule({ "0,0": [{ x: 98, y: 50, vx: 10, gid: 7 }], "1,0": full }, 2));
    const client = connect(host);
    client.send(encodeGenerate(0, 0, 1));
    client.send(encodeGenerate(1, 0, 1));
    client.send(encodeTier(0, 0, Tier.Hot, 1));
    host.tick();
    const position = positionOf(host, 7)!;
    expect(position.cx).toBe(0);
    expect(position.x).toBeLessThan(SIZE);
    expect(gidsIn(host, 1, 0)).toEqual([101, 102]);
    expect(host.dropped).toBe(0);
  });

  test("hands an entity to a chunk on another host through a peer link", () => {
    const layout = { "0,0": [{ x: 98, y: 50, vx: 10, gid: 7 }], "1,0": [] };
    const a = new ChunkHost(testModule(layout));
    const b = new ChunkHost(testModule(layout));
    const [ab, ba] = memoryTransportPair();
    a.addPeer(1, ab);
    b.addPeer(0, ba);
    const clientA = connect(a);
    const clientB = connect(b);
    clientA.send(encodeRoute(0, [{ cx: 1, cy: 0, host: 1 }]));
    clientB.send(encodeRoute(1, [{ cx: 0, cy: 0, host: 0 }]));
    clientA.send(encodeGenerate(0, 0, 1));
    clientB.send(encodeGenerate(1, 0, 1));
    clientA.send(encodeTier(0, 0, Tier.Hot, 1));
    a.tick();
    expect(positionOf(a, 7)).toBeNull();
    expect(positionOf(b, 7)).toEqual({ cx: 1, cy: 0, x: 8, y: 50 });
  });

  test("a full chunk on another host returns the rows to their origin", () => {
    const layout = {
      "0,0": [{ x: 98, y: 50, vx: 10, gid: 7 }],
      "1,0": [1, 2].map((gid) => ({ x: 50, y: 50, gid: 100 + gid })),
    };
    const a = new ChunkHost(testModule(layout, 2));
    const b = new ChunkHost(testModule(layout, 2));
    const [ab, ba] = memoryTransportPair();
    a.addPeer(1, ab);
    b.addPeer(0, ba);
    const clientA = connect(a);
    const clientB = connect(b);
    clientA.send(encodeRoute(0, [{ cx: 1, cy: 0, host: 1 }]));
    clientB.send(encodeRoute(1, [{ cx: 0, cy: 0, host: 0 }]));
    clientA.send(encodeGenerate(0, 0, 1));
    clientB.send(encodeGenerate(1, 0, 1));
    clientA.send(encodeTier(0, 0, Tier.Hot, 1));
    a.tick();
    const position = positionOf(a, 7)!;
    expect(position.cx).toBe(0);
    expect(position.x).toBeLessThan(SIZE);
    expect(a.dropped + b.dropped).toBe(0);
  });

  test("forwards a transfer through the client when there is no peer link", () => {
    const layout = { "0,0": [{ x: 98, y: 50, vx: 10, gid: 7 }], "1,0": [] };
    const a = new ChunkHost(testModule(layout));
    const b = new ChunkHost(testModule(layout));
    const clientA = connect(a);
    const clientB = connect(b);
    clientA.send(encodeRoute(0, [{ cx: 1, cy: 0, host: 1 }]));
    clientA.send(encodeGenerate(0, 0, 1));
    clientB.send(encodeGenerate(1, 0, 1));
    clientA.send(encodeTier(0, 0, Tier.Hot, 1));
    a.tick();
    const transfer = clientA.last(Op.Transfer)!;
    expect(transfer).toMatchObject({ cx: 1, cy: 0, fx: 0, fy: 0, count: 1 });
    // What a pool does: pass the bytes on to the owning host unchanged.
    const { cx, cy, fx, fy, returned, count, rows } = transfer;
    clientB.send(encodeTransfer(cx, cy, fx, fy, returned, count, rows));
    expect(positionOf(b, 7)).toEqual({ cx: 1, cy: 0, x: 8, y: 50 });
  });

  test("unload returns bytes that load back into the same chunk", () => {
    const host = new ChunkHost(testModule({ "2,3": [{ x: 10, y: 20, vx: 1, gid: 5 }] }));
    const client = connect(host);
    client.send(encodeGenerate(2, 3, 1));
    client.send(encodeUnload(2, 3));
    const unloaded = client.last(Op.Unloaded)!;
    expect(host.chunks.size).toBe(0);

    const other = new ChunkHost(testModule({}));
    const otherClient = connect(other);
    otherClient.send(encodeLoad(2, 3, unloaded.bytes));
    expect(otherClient.last(Op.Ready)).toMatchObject({ cx: 2, cy: 3, population: 1 });
    expect(positionOf(other, 5)).toEqual({ cx: 2, cy: 3, x: 10, y: 20 });
  });

  test("a module's lean world type shapes loaded chunks, and deserialize overrides it", () => {
    const Chunk = leanWorldType({ size: 16, components: [TestPos, TestVel, TestGid] });
    const leanModule = (): ChunkModule => {
      const base = testModule({});
      return {
        ...base,
        world: Chunk,
        generate(_seed, cx, cy) {
          const world = Chunk.create();
          if (cx === 2 && cy === 3) {
            const eid = addEntity(world);
            addComponent(world, TestPos, eid, { x: 10, y: 20 });
            addComponent(world, TestVel, eid);
            addComponent(world, TestGid, eid, { id: 5 });
          }
          return world;
        },
      };
    };
    const host = new ChunkHost(leanModule());
    const client = connect(host);
    client.send(encodeGenerate(2, 3, 1));
    expect([...host.chunks.values()][0].world.componentMap.size).toBe(3);
    client.send(encodeUnload(2, 3));
    const bytes = client.last(Op.Unloaded)!.bytes;

    const other = new ChunkHost(leanModule());
    connect(other).send(encodeLoad(2, 3, bytes));
    const loaded = [...other.chunks.values()][0].world;
    expect(new Set(loaded.componentMap.keys())).toEqual(new Set([TestPos, TestVel, TestGid]));
    expect(positionOf(other, 5)).toEqual({ cx: 2, cy: 3, x: 10, y: 20 });

    const calls: number[][] = [];
    const custom = new ChunkHost({ ...leanModule(), deserialize: (b, cx, cy, space) => (calls.push([cx, cy, space]), Chunk.deserialize(b.slice().buffer)) });
    connect(custom).send(encodeLoad(2, 3, bytes));
    expect(calls).toEqual([[2, 3, 0]]);
    expect(positionOf(custom, 5)).toEqual({ cx: 2, cy: 3, x: 10, y: 20 });
  });

  test("tracks an entity across a hand-off and routes its input to the right chunk", () => {
    const host = new ChunkHost(testModule({ "0,0": [{ x: 90, y: 50, gid: 9 }], "1,0": [] }));
    const client = connect(host);
    client.send(encodeGenerate(0, 0, 1));
    client.send(encodeGenerate(1, 0, 1));
    client.send(encodeTier(0, 0, Tier.Hot, 1));
    client.send(encodeTier(1, 0, Tier.Hot, 1));
    client.send(encodeTrack([9]));
    client.send(encodeInput(9, new Uint8Array([128 + 20])));
    host.tick();
    expect(client.last(Op.Locate)!.entries).toEqual([{ gid: 9, space: 0, cx: 1, cy: 0, x: 10, y: 50, tint: 7 }]);
    host.tick();
    expect(client.last(Op.Locate)!.entries[0]).toMatchObject({ cx: 1, x: 30 });
  });

  test("empty input releases a controlled entity", () => {
    const host = new ChunkHost(testModule({ "0,0": [{ x: 10, y: 50, gid: 4 }] }));
    const client = connect(host);
    client.send(encodeGenerate(0, 0, 1));
    client.send(encodeTier(0, 0, Tier.Hot, 1));
    client.send(encodeInput(4, new Uint8Array([128 + 5])));
    host.tick();
    // Controlled entities are located even when nobody tracks them.
    const located = client.all(Op.Locate).length;
    expect(located).toBe(1);
    client.send(encodeInput(4, new Uint8Array(0)));
    host.tick();
    host.tick();
    expect(client.all(Op.Locate)).toHaveLength(located);
  });

  test("configuration reaches the module", () => {
    const host = new ChunkHost(testModule({ "0,0": [{ x: 10, y: 10, vx: 1, gid: 1 }] }));
    const client = connect(host);
    client.send(encodeGenerate(0, 0, 1));
    client.send(encodeTier(0, 0, Tier.Hot, 1));
    client.send(encodeConfig(new Uint8Array([3])));
    host.tick();
    expect(positionOf(host, 1)!.x).toBe(13);
  });

  test("a route entry of NO_HOST forgets the chunk's owner", () => {
    const host = new ChunkHost(testModule({ "0,0": [{ x: 98, y: 50, vx: 10, gid: 7 }] }));
    const client = connect(host);
    client.send(encodeRoute(0, [{ cx: 1, cy: 0, host: 1 }]));
    client.send(encodeRoute(0, [{ cx: 1, cy: 0, host: NO_HOST }]));
    client.send(encodeGenerate(0, 0, 1));
    client.send(encodeTier(0, 0, Tier.Hot, 1));
    host.tick();
    expect(client.all(Op.Transfer)).toHaveLength(0);
    expect(positionOf(host, 7)!.cx).toBe(0);
  });

  test("tells the module the current tick when a chunk is generated or loaded", () => {
    const seen: string[] = [];
    const module = testModule({ "0,0": [{ x: 10, y: 20, gid: 5 }] });
    module.restored = (world, ctx) => seen.push(`${ctx.cx},${ctx.cy}@${ctx.tick}:${ctx.generated}:${world.entitySparseSet.dense.length}`);
    const host = new ChunkHost(module);
    const client = connect(host);
    for (let i = 0; i < 3; i++) host.tick();
    client.send(encodeGenerate(0, 0, 1));
    client.send(encodeUnload(0, 0));
    host.tick();
    client.send(encodeLoad(0, 0, client.last(Op.Unloaded)!.bytes));
    expect(seen).toEqual(["0,0@3:true:1", "0,0@4:false:1"]);
  });

  test("lets the module shift chunk-local fields of entities that arrive from a neighbour", () => {
    const module = testModule({ "0,0": [{ x: 98, y: 50, vx: 10, gid: 7 }], "1,0": [] });
    const shifts: number[][] = [];
    module.arrived = (world, eid, dx, dy) => shifts.push([world(TestGid).store.id[eid], dx, dy]);
    const host = new ChunkHost(module);
    const client = connect(host);
    client.send(encodeGenerate(0, 0, 1));
    client.send(encodeGenerate(1, 0, 1));
    client.send(encodeTier(0, 0, Tier.Hot, 1));
    host.tick();
    expect(shifts).toEqual([[7, -SIZE, 0]]);
  });

  test("a step covers ticks the clock skipped", () => {
    const module = testModule({ "0,0": [{ x: 10, y: 10, vx: 1, gid: 1 }] });
    const ticks: number[] = [];
    const step = module.step;
    module.step = (world, ctx) => {
      ticks.push(ctx.ticks);
      step(world, ctx);
    };
    const host = new ChunkHost(module);
    const client = connect(host);
    client.send(encodeGenerate(0, 0, 1));
    client.send(encodeTier(0, 0, Tier.Hot, 1));
    host.tick();
    host.tick();
    // What the tick loop does when it falls behind: skip tick numbers rather than drift.
    host.tickCount += 5;
    host.tick();
    expect(ticks).toEqual([1, 1, 6]);
    expect(positionOf(host, 1)!.x).toBe(18);
  });
});
