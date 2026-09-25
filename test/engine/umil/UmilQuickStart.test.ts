import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const calls = vi.hoisted(() => [] as string[]);

vi.mock("yage/ui/UIService", () => ({
  UIService: {
    getInstance: () => ({}),
  },
}));
vi.mock("yage/inputs/KeyboardListener", () => ({
  KeyboardListener: class {
    init = vi.fn();
  },
}));
vi.mock("yage/game/mobileFullscreen", () => ({
  ensureMobileFullscreenButton: vi.fn(),
}));
vi.mock("yage/connection/SingleplayerConnectionInstance", () => ({
  SingleplayerConnectionInstance: class {
    constructor() {
      calls.push("singleplayerConnection");
    }
    connect = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock("yage/connection/E2EConnectionInstance", () => ({
  E2EConnectionInstance: class {
    constructor() {
      calls.push("e2eConnection");
    }
    connect = vi.fn().mockResolvedValue(undefined);
  },
}));
vi.mock("yage/connection/PeerMultiplayerInstance", () => ({
  PeerMultiplayerInstance: class {},
}));
vi.mock("yage/connection/SocketIoMultiplayerInstance", () => ({
  SocketIoMultiplayerInstance: class {},
}));
vi.mock("yage/game/GameInstance", () => ({
  GameInstance: class {
    initializeRoom = vi.fn().mockResolvedValue(undefined);
    stepManual = vi.fn();
    constructor() {
      calls.push("gameInstance");
    }
  },
}));
vi.mock("yage/testing/E2EBridge", () => ({
  E2EBridge: class {
    ready = false;
    constructor() {
      calls.push("bridge");
    }
  },
}));

import { UmilQuickStart } from "yage/umil/UmilQuickStart";

describe("UmilQuickStart e2e mode", () => {
  const originalSearch = window.location.search;

  beforeEach(() => {
    calls.length = 0;
    // @ts-ignore - the test window stub allows assignment
    window.location.search = "?e2e=true";
    // @ts-ignore
    window.__YAGE_E2E__ = undefined;
  });

  afterEach(() => {
    // @ts-ignore
    window.location.search = originalSearch;
  });

  it("runs the caller's preload before creating the game instance", async () => {
    const preload = vi.fn(() => {
      calls.push("preload");
      return Promise.resolve();
    });

    await UmilQuickStart<null>({
      gameName: "Test",
      onPlayerJoin: () => 0,
      preload,
    });

    expect(preload).toHaveBeenCalledTimes(1);
    // The game's entity factory is configured during preload; a GameModel
    // constructed before it would crash on core-entity generation.
    expect(calls).toEqual(["preload", "e2eConnection", "gameInstance", "bridge"]);
  });

  it("injects a ready E2EBridge for Playwright RPC", async () => {
    await UmilQuickStart<null>({
      gameName: "Test",
      onPlayerJoin: () => 0,
      preload: vi.fn().mockResolvedValue(undefined),
    });

    const bridge = (window as any).__YAGE_E2E__;
    expect(bridge).toBeDefined();
    expect(bridge.ready).toBe(true);
  });
});
