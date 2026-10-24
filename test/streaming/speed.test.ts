import { afterEach, describe, expect, test, vi } from "vitest";
import { ChunkHost } from "yage/streaming/host";
import { decodeMessage, encodeSpeed, Op } from "yage/streaming/protocol";
import { memoryTransportPair } from "yage/streaming/transport";
import { testModule } from "./fixture";

describe("host clock speed", () => {
  afterEach(() => vi.useRealTimers());

  test("encodes speed in hundredths, 0 for paused", () => {
    expect(decodeMessage(encodeSpeed(4))).toEqual({ op: Op.Speed, speed: 4 });
    expect(decodeMessage(encodeSpeed(0))).toEqual({ op: Op.Speed, speed: 0 });
    expect(decodeMessage(encodeSpeed(-2))).toEqual({ op: Op.Speed, speed: 0 });
  });

  test("runs ticks at the set multiple of the tick rate, and none while paused", () => {
    vi.useFakeTimers();
    const host = new ChunkHost(testModule({ "0,0": [] })); // 10 ticks a second
    const [client, side] = memoryTransportPair();
    host.attach(side);
    host.start();
    vi.advanceTimersByTime(1000);
    const real = host.tickCount;
    expect(real).toBeGreaterThanOrEqual(9);
    expect(real).toBeLessThanOrEqual(11);
    client.send(encodeSpeed(0));
    vi.advanceTimersByTime(1);
    const paused = host.tickCount;
    vi.advanceTimersByTime(2000);
    expect(host.tickCount).toBe(paused);
    client.send(encodeSpeed(4));
    vi.advanceTimersByTime(1000);
    const fast = host.tickCount - paused;
    expect(fast).toBeGreaterThanOrEqual(38);
    expect(fast).toBeLessThanOrEqual(42);
    host.stop();
  });
});
