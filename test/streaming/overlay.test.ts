import { describe, expect, test } from "vitest";
import { ChunkHost, type StepContext } from "yage/streaming/host";
import { ChunkPool } from "yage/streaming/pool";
import { decodeMessage, encodeGenerate, encodeHello, encodeOverlay, encodeTier, Op, Tier, type Message } from "yage/streaming/protocol";
import { memoryTransportPair } from "yage/streaming/transport";
import { testModule } from "./fixture";

const connect = (host: ChunkHost) => {
  const [client, hostSide] = memoryTransportPair();
  host.attach(hostSide);
  const messages: Message[] = [];
  client.onMessage((bytes) => messages.push(decodeMessage(bytes)));
  client.send(encodeHello());
  return { send: (bytes: Uint8Array) => client.send(bytes), messages };
};

describe("overlay and hot steps", () => {
  test("Overlay round-trips its address, tick and bytes", () => {
    const message = decodeMessage(encodeOverlay(-3, 4, 77, new Uint8Array([9, 8, 7]), 2));
    expect(message).toMatchObject({ op: Op.Overlay, space: 2, cx: -3, cy: 4, tick: 77 });
    expect([...(message as Extract<Message, { op: Op.Overlay }>).bytes]).toEqual([9, 8, 7]);
  });

  test("a module's overlay follows each snapshot of a hot chunk, built once for every client", () => {
    const base = testModule({ "0,0": [{ x: 10, y: 10, gid: 1 }] });
    let built = 0;
    const host = new ChunkHost({
      ...base,
      overlay(_world, snapshot) {
        built++;
        return snapshot.tick % 2 === 0 ? new Uint8Array([snapshot.tick]) : null;
      },
    });
    const a = connect(host);
    const b = connect(host);
    a.send(encodeGenerate(0, 0, 1));
    for (const c of [a, b]) c.send(encodeTier(0, 0, Tier.Hot, 1));
    for (let i = 0; i < 4; i++) host.tick();
    expect(built).toBe(4);
    for (const c of [a, b]) {
      const ops = c.messages.filter((m) => m.op === Op.Snapshot || m.op === Op.Overlay).map((m) => m.op);
      expect(ops).toEqual([Op.Snapshot, Op.Overlay, Op.Snapshot, Op.Snapshot, Op.Overlay, Op.Snapshot]);
      const overlays = c.messages.filter((m) => m.op === Op.Overlay) as Extract<Message, { op: Op.Overlay }>[];
      expect(overlays.map((o) => [o.tick, o.bytes[0]])).toEqual([[0, 0], [2, 2]]);
    }
  });

  test("modules without an overlay send none (unchanged behaviour)", () => {
    const host = new ChunkHost(testModule({ "0,0": [{ x: 10, y: 10, gid: 1 }] }));
    const c = connect(host);
    c.send(encodeGenerate(0, 0, 1));
    c.send(encodeTier(0, 0, Tier.Hot, 1));
    host.tick();
    expect(c.messages.some((m) => m.op === Op.Overlay)).toBe(false);
  });

  test("steps say whether the chunk is hot", () => {
    const base = testModule({ "0,0": [{ x: 10, y: 10, gid: 1 }] });
    const seen: boolean[] = [];
    const host = new ChunkHost({ ...base, step: (world, ctx: StepContext) => (seen.push(!!ctx.hot), base.step(world, ctx)) });
    const c = connect(host);
    c.send(encodeGenerate(0, 0, 1));
    for (let i = 0; i < 4; i++) host.tick();
    c.send(encodeTier(0, 0, Tier.Hot, 1));
    host.tick();
    expect(seen).toEqual([false, true]);
  });

  test("the pool hands overlays to the game", () => {
    const base = testModule({ "0,0": [{ x: 10, y: 10, gid: 1 }] });
    const host = new ChunkHost({ ...base, overlay: () => new Uint8Array([5]) });
    const pool = new ChunkPool(() => 0);
    const [client, hostSide] = memoryTransportPair();
    host.attach(hostSide);
    pool.addHost(client, "local");
    const got: number[][] = [];
    pool.on({ overlay: (o) => got.push([o.cx, o.cy, o.tick, ...o.bytes]) });
    pool.generate(0, 0, 1);
    pool.setTier(0, 0, Tier.Hot, 1);
    host.tick();
    expect(got).toEqual([[0, 0, 0, 5]]);
  });
});
