import { describe, expect, it } from "vitest";
import { createSnapshot, decodeMessage, decodeSnapshot, encodeGenerate, encodeTransfer, MAX_SPRITE, Op, PROTOCOL_VERSION, snapshotBytes } from "yage/streaming/protocol";

describe("snapshot sprite ids", () => {
  it("carries u16 sprite ids through encode and decode", () => {
    const s = createSnapshot(3, -2, 77, 5, 1);
    const ids = [0, 255, 256, 4097, MAX_SPRITE];
    ids.forEach((id, i) => {
      s.sprite[i] = id;
      s.tint[i] = i;
      s.gid[i] = 1000 + i;
      s.x[i] = -i * 8;
      s.y[i] = i * 8;
    });
    expect(s.bytes.byteLength).toBe(snapshotBytes(5));
    // Socket frames may arrive at any offset: decode from a misaligned copy.
    const padded = new Uint8Array(s.bytes.byteLength + 1);
    padded.set(s.bytes, 1);
    const d = decodeSnapshot(padded.subarray(1));
    expect([...d.sprite]).toEqual(ids);
    expect([...d.tint]).toEqual([0, 1, 2, 3, 4]);
    expect([...d.gid]).toEqual([1000, 1001, 1002, 1003, 1004]);
    expect([d.space, d.cx, d.cy, d.tick]).toEqual([1, 3, -2, 77]);
    const m = decodeMessage(s.bytes);
    expect(m.op).toBe(Op.Snapshot);
    expect(PROTOCOL_VERSION).toBeGreaterThanOrEqual(4);
  });

  it("keeps every typed array aligned for any count", () => {
    for (const n of [0, 1, 2, 3, 7, 100]) {
      const s = createSnapshot(0, 0, 0, n);
      expect(s.sprite.byteOffset % 2).toBe(0);
      expect(s.gid.byteOffset % 4).toBe(0);
    }
  });
});

describe("far chunk addresses", () => {
  // A true-scale Earth spans ~312k chunks of 128 m: Tampa and Sydney from a Seville origin sit past i16.
  const far = [
    [-52_800, 9_400],
    [108_000, 52_700],
    [-262_144, 262_143],
  ];
  it("carries chunk coordinates past ±32767 through snapshots and chunk messages", () => {
    for (const [cx, cy] of far) {
      const s = createSnapshot(cx, cy, 9, 2, 3);
      expect([decodeSnapshot(s.bytes).cx, decodeSnapshot(s.bytes).cy]).toEqual([cx, cy]);
      const transfer = decodeMessage(encodeTransfer(cx, cy, cy, cx, true, 1, new Uint8Array([7]), 3));
      expect(transfer).toMatchObject({ op: Op.Transfer, space: 3, cx, cy, fx: cy, fy: cx, count: 1 });
      expect(decodeMessage(encodeGenerate(cx, cy, 5, 2))).toMatchObject({ op: Op.Generate, space: 2, cx, cy, seed: 5 });
    }
  });
});
