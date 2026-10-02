import { describe, expect, it, vi } from "vitest";
import { PeerMultiplayerInstance } from "../../engine/connection/PeerMultiplayerInstance";
import type { InputManager } from "../../engine/inputs/InputManager";

const peerMock = vi.hoisted(() => {
  let connectionOpenDelay = 0;
  let collideNextPeerId = false;

  class MockPeer {
    id: string;
    options: unknown;
    lastConnection: ReturnType<typeof makeConnection> | null = null;
    connectionTargets: string[] = [];
    handlers: Record<string, ((...args: any[]) => void)[]> = {};
    destroyed = false;

    constructor(id: string, options?: unknown) {
      this.id = id;
      this.options = options;
      queueMicrotask(() => {
        if (collideNextPeerId) {
          collideNextPeerId = false;
          this.emitLocal("error", { type: "unavailable-id", message: "ID is taken" });
          return;
        }
        this.emitLocal("open", id);
      });
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
      const connection = makeConnection(peerId);
      this.lastConnection = connection;
      this.connectionTargets.push(peerId);
      if (connectionOpenDelay > 0) {
        setTimeout(() => connection.emitLocal("open"), connectionOpenDelay);
      }
      return connection;
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

  return {
    MockPeer,
    makeConnection,
    setConnectionOpenDelay: (delay: number) => {
      connectionOpenDelay = delay;
    },
    collideNextPeerId: () => {
      collideNextPeerId = true;
    },
  };
});

vi.mock("peerjs", () => ({
  default: peerMock.MockPeer,
}));

describe("PeerMultiplayerInstance", () => {
  it("uses TLS for a public signaling server on port 443", async () => {
    const instance = new PeerMultiplayerInstance({
      netId: "player-1",
      uniqueId: "player-1",
      token: "token-1",
      config: {},
    }, {} as InputManager, {
      prefix: "test-",
      address: "host",
      host: "peer.yage.games",
    });
    await instance.connectionPromise;

    expect((instance.peer as unknown as { options: unknown }).options).toEqual({
      host: "peer.yage.games",
      port: 443,
      path: "/",
      secure: true,
    });
  });

  it("waits for a slow peer data connection before timing out", async () => {
    peerMock.setConnectionOpenDelay(1_200);
    peerMock.collideNextPeerId();
    const instance = new PeerMultiplayerInstance({
      netId: "player-1",
      uniqueId: "player-1",
      token: "token-1",
      config: {},
    }, {} as InputManager, {
      prefix: "test-",
      address: "room",
      host: "peer.yage.games",
    });

    try {
      await expect(instance.connect()).resolves.toBeUndefined();
      expect(instance.player.connected).toBe(true);
    } finally {
      peerMock.setConnectionOpenDelay(0);
    }
  });

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
  it("an explicit join registers a unique peer before connecting the existing room", async () => {
    peerMock.setConnectionOpenDelay(1);
    const instance = new PeerMultiplayerInstance({netId:"joiner",uniqueId:"joiner",token:"token",config:{}}, {} as InputManager,
      {prefix:"test-",address:"room",requireExistingHost:true});
    try {
      await instance.connect();
      expect(instance.selfAddress).not.toBe("test-room");
      expect((instance.peer as unknown as InstanceType<typeof peerMock.MockPeer>).connectionTargets).toContain("test-room");
      expect(instance.player.connected).toBe(true);
    } finally {peerMock.setConnectionOpenDelay(0);}
  });

  it("missing or incompatible room rejects and destroys the temporary peer", async () => {
    const instance = new PeerMultiplayerInstance({netId:"joiner",uniqueId:"joiner",token:"token",config:{}}, {} as InputManager,
      {prefix:"test-",address:"missing",requireExistingHost:true});
    const connection = instance.connect();
    const rejected = expect(connection).rejects.toThrow("Room unavailable or running a different game build");
    await instance.connectionPromise;await Promise.resolve();
    const peer = instance.peer as unknown as InstanceType<typeof peerMock.MockPeer>;
    peer.emitLocal("error",{type:"peer-unavailable",message:"No such peer"});
    await rejected;
    expect(peer.destroyed).toBe(true);
    expect(peer.lastConnection?.close).toHaveBeenCalled();
    expect(instance.player.connected).toBe(false);
  });

  it("an explicit join cannot materialize itself as the requested host", async () => {
    const instance = new PeerMultiplayerInstance({netId:"joiner",uniqueId:"joiner",token:"token",config:{}}, {} as InputManager,
      {prefix:"test-",address:"room",requireExistingHost:true});
    await instance.connectionPromise;
    instance.selfAddress="test-room";
    await expect(instance.connect()).rejects.toThrow("Room unavailable");
    expect((instance.peer as unknown as InstanceType<typeof peerMock.MockPeer>).destroyed).toBe(true);
  });

  it("a stalled explicit join rejects before room initialization and closes signaling", async () => {
    vi.useFakeTimers();
    const instance = new PeerMultiplayerInstance({netId:"joiner",uniqueId:"joiner",token:"token",config:{}}, {} as InputManager,
      {prefix:"test-",address:"room",requireExistingHost:true});
    try {
      await vi.advanceTimersByTimeAsync(0);
      const rejected=expect(instance.connect()).rejects.toThrow("Room unavailable");
      await vi.advanceTimersByTimeAsync(10000);await rejected;
      expect((instance.peer as unknown as InstanceType<typeof peerMock.MockPeer>).destroyed).toBe(true);
    } finally {vi.useRealTimers();}
  });

  it("a signaling failure before open rejects connect without an unhandled constructor promise", async () => {
    const instance = new PeerMultiplayerInstance({netId:"joiner",uniqueId:"joiner",token:"token",config:{}}, {} as InputManager,
      {prefix:"test-",address:"room",requireExistingHost:true});
    const peer = instance.peer as unknown as InstanceType<typeof peerMock.MockPeer>;
    peer.emitLocal("error",{type:"network",message:"Signaling disconnected"});
    await expect(instance.connect()).rejects.toThrow("Room unavailable");
    await Promise.resolve();
    expect(peer.destroyed).toBe(true);
    expect(instance.player.connected).toBe(false);
  });

});
