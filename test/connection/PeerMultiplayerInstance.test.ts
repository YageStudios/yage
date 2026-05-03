import { describe, expect, it, vi } from "vitest";
import { PeerMultiplayerInstance } from "../../engine/connection/PeerMultiplayerInstance";
import type { InputManager } from "../../engine/inputs/InputManager";

const peerMock = vi.hoisted(() => {
  class MockPeer {
    id: string;
    handlers: Record<string, ((...args: any[]) => void)[]> = {};
    destroyed = false;

    constructor(id: string) {
      this.id = id;
      queueMicrotask(() => this.emitLocal("open", id));
    }

    on(event: string, cb: (...args: any[]) => void) {
      this.handlers[event] = this.handlers[event] ?? [];
      this.handlers[event].push(cb);
      return this;
    }

    off(event: string) {
      delete this.handlers[event];
      return this;
    }

    destroy() {
      this.destroyed = true;
    }

    connect(peerId: string) {
      return makeConnection(peerId);
    }

    emitLocal(event: string, ...args: any[]) {
      for (const cb of this.handlers[event] ?? []) cb(...args);
    }
  }

  const makeConnection = (peerId: string) => {
    const handlers: Record<string, ((...args: any[]) => void)[]> = {};
    const conn = {
      peer: peerId,
      send: vi.fn(),
      close: vi.fn(() => {
        for (const cb of handlers.close ?? []) cb();
      }),
      on: vi.fn((event: string, cb: (...args: any[]) => void) => {
        handlers[event] = handlers[event] ?? [];
        handlers[event].push(cb);
        return conn;
      }),
      once: vi.fn((event: string, cb: (...args: any[]) => void) => {
        const wrapped = (...args: any[]) => {
          handlers[event] = (handlers[event] ?? []).filter((handler) => handler !== wrapped);
          cb(...args);
        };
        handlers[event] = handlers[event] ?? [];
        handlers[event].push(wrapped);
        return conn;
      }),
      emitLocal: (event: string, ...args: any[]) => {
        for (const cb of handlers[event] ?? []) cb(...args);
      },
    };
    return conn;
  };

  return { MockPeer, makeConnection };
});

vi.mock("peerjs", () => ({
  default: peerMock.MockPeer,
}));

describe("PeerMultiplayerInstance", () => {
  it("reports the closed peer as the disconnected player", async () => {
    const localPlayer = {
      netId: "player-1",
      uniqueId: "player-1",
      token: "token-1",
      config: {},
    };
    const instance = new PeerMultiplayerInstance(localPlayer, {} as InputManager, {
      prefix: "test-",
      address: "host",
    });
    await instance.connectionPromise;

    const received: any[] = [];
    instance.handleData = vi.fn((data: any) => {
      received.push(data);
    });
    instance.players.push({
      netId: "player-2",
      uniqueId: "player-2",
      token: "token-2",
      config: {},
      connected: true,
      connectionTime: Date.now(),
      connectionId: "peer-2",
      currentRoomId: "room-1",
      roomsSynced: true,
      hostedRooms: ["room-1"],
    });

    const conn = peerMock.makeConnection("peer-2");
    instance.handleConnection(conn as any);
    conn.emitLocal("close");

    expect(received).toContainEqual(["player-2", "userDisconnect"]);
    expect(received).not.toContainEqual(["player-1", "userDisconnect", "player-2"]);
  });
});
