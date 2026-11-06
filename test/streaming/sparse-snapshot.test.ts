import { describe, expect, test } from "vitest";
import { ChunkHost, type ChunkModule } from "yage/streaming/host";
import {
  createSnapshot,
  decodeMessage,
  decodeSnapshot,
  EMPTY_SLOT,
  encodeGenerate,
  encodeHello,
  encodeTier,
  Op,
  packSnapshot,
  snapshotBytes,
  SnapshotFormat,
  sparseSnapshotBytes,
  Tier,
  type Snapshot,
} from "yage/streaming/protocol";
import { memoryTransportPair } from "yage/streaming/transport";
import { testModule } from "./fixture";

/** A seeded LCG: these frames are the same on every run. */
const lcg = (seed: number) => () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 2 ** 32);

/** A frame shaped like a game's: `fill` of the slots drawn, some hidden ones with a gid left behind. */
const frame = (random: () => number, count: number, fill: number) => {
  const s = createSnapshot(Math.floor(random() * 9) - 4, -3, Math.floor(random() * 1e6), count, 2);
  s.tint.fill(EMPTY_SLOT);
  for (let i = 0; i < count; i++) {
    const r = random();
    if (r < fill) {
      s.gid[i] = 1 + Math.floor(random() * 2 ** 32 - 2);
      s.x[i] = Math.floor(random() * 65536) - 32768;
      s.y[i] = Math.floor(random() * 65536) - 32768;
      s.sprite[i] = Math.floor(random() * 65536);
      s.tint[i] = Math.floor(random() * 255);
    } else if (r < fill + 0.05) {
      // Written but not drawn (an upstairs or ward-hidden resident): still a filled slot.
      s.gid[i] = 7 + i;
      s.x[i] = i;
    }
  }
  return s;
};

const same = (a: Snapshot, b: Snapshot) => {
  expect([a.space, a.cx, a.cy, a.tick, a.count]).toEqual([b.space, b.cx, b.cy, b.tick, b.count]);
  // The views are the message's bytes: equal bytes are equal gid, x, y, sprite and tint columns.
  for (const k of ["gid", "x", "y", "sprite", "tint"] as const) expect(a[k].byteOffset - a.bytes.byteOffset).toBe(b[k].byteOffset - b.bytes.byteOffset);
  expect(Buffer.from(a.bytes.buffer, a.bytes.byteOffset, a.bytes.byteLength).equals(Buffer.from(b.bytes.buffer, b.bytes.byteOffset, b.bytes.byteLength))).toBe(true);
};

describe("sparse snapshots", () => {
  test("decode exactly to the dense snapshot over many frames, sent whichever way is smaller", () => {
    const random = lcg(42);
    let sparse = 0;
    for (let n = 0; n < 300; n++) {
      const count = [0, 1, 7, 8, 9, 31, 32, 33, 200, 1500][n % 10];
      const s = frame(random, count, [0, 0.02, 0.3, 0.6, 0.9, 1][n % 6]);
      const wire = packSnapshot(s);
      const dense = decodeSnapshot(s.bytes);
      const decoded = decodeSnapshot(wire);
      same(decoded, dense);
      expect(wire.byteLength).toBeLessThanOrEqual(snapshotBytes(count));
      expect(decoded.wire).toBe(wire.byteLength);
      if (wire[1] === SnapshotFormat.Sparse) sparse++;
      else expect(wire).toBe(s.bytes);
      // Socket frames may arrive at any offset.
      const padded = new Uint8Array(wire.byteLength + 3);
      padded.set(wire, 3);
      same(decodeSnapshot(padded.subarray(3)), dense);
    }
    expect(sparse).toBeGreaterThan(100);
  });

  test("a full chunk is sent dense, a mostly empty one costs a bit per slot plus its filled slots", () => {
    const full = frame(lcg(1), 64, 1);
    expect(packSnapshot(full)).toBe(full.bytes);
    const empty = createSnapshot(0, 0, 0, 640);
    empty.tint.fill(EMPTY_SLOT);
    empty.tint[600] = 3;
    const wire = packSnapshot(empty);
    expect(wire.byteLength).toBe(sparseSnapshotBytes(640, 1));
    expect(wire.byteLength).toBeLessThan(snapshotBytes(640) / 9);
    same(decodeSnapshot(wire), decodeSnapshot(empty.bytes));
  });

  test("a truncated or corrupt sparse snapshot throws", () => {
    const s = frame(lcg(3), 100, 0.2);
    const wire = packSnapshot(s);
    expect(wire[1]).toBe(SnapshotFormat.Sparse);
    expect(() => decodeSnapshot(wire.slice(0, wire.byteLength - 1))).toThrow();
    const lying = wire.slice();
    new DataView(lying.buffer).setUint32(20, new DataView(wire.buffer).getUint32(20, true) - 1, true);
    expect(() => decodeSnapshot(lying)).toThrow();
  });

  test("a host's frames with removal and reuse (walkers crossing back and forth) decode to what it rendered", () => {
    const walkers = Array.from({ length: 12 }, (_, i) => ({ x: 90 + (i % 4), y: 10 + i * 7, vx: i % 3 === 0 ? 3 : i % 3 === 1 ? -3 : 0, gid: 100 + i }));
    const base = testModule({ "0,0": walkers, "1,0": walkers.map((w) => ({ ...w, x: w.x - 85, vx: -(w.vx ?? 0), gid: w.gid + 50 })) }, 64);
    const rendered: Uint8Array[] = [];
    const module: ChunkModule = {
      ...base,
      render(world, snapshot) {
        base.render(world, snapshot);
        rendered.push(snapshot.bytes.slice());
      },
    };
    const host = new ChunkHost(module);
    const [client, side] = memoryTransportPair();
    host.attach(side);
    const got: Snapshot[] = [];
    let sent = 0;
    client.onMessage((bytes) => {
      const m = decodeMessage(bytes);
      if (m.op !== Op.Snapshot) return;
      got.push(m.snapshot);
      if (bytes[1] === SnapshotFormat.Sparse) sent++;
    });
    client.send(encodeHello());
    for (const cx of [0, 1]) {
      client.send(encodeGenerate(cx, 0, 1));
      client.send(encodeTier(cx, 0, Tier.Hot, 1));
    }
    for (let i = 0; i < 40; i++) host.tick();
    expect(got.length).toBe(rendered.length);
    for (let i = 0; i < got.length; i++) expect(got[i].bytes).toEqual(rendered[i]);
    expect(sent).toBeGreaterThan(0);
  });
});
