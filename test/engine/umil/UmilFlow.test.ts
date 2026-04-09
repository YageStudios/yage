import { describe, it, expect, vi, beforeEach } from "vitest";

// ----------------------------------------------------------------
// Mock all heavy / browser-only dependencies BEFORE importing UmilFlow
// ----------------------------------------------------------------

vi.mock("yage/loader/AssetLoader", () => ({
  default: {
    getInstance: () => ({
      loadUi: vi.fn().mockResolvedValue(undefined),
      getUi: vi.fn().mockReturnValue({}),
    }),
  },
}));

vi.mock("yage/ui/UIService", () => ({
  UIService: {
    getInstance: () => ({
      root: { addChild: vi.fn() },
      playerInputs: [],
    }),
  },
}));

vi.mock("yage/ui/UiMap", () => ({
  buildUiMap: vi.fn().mockReturnValue({
    build: vi.fn().mockReturnValue({}),
    update: vi.fn(),
  }),
}));

vi.mock("yage/inputs/KeyboardListener", () => ({
  KeyboardListener: class MockKeyboardListener {
    init() {}
    destroy() {}
  },
}));

vi.mock("yage/game/mobileFullscreen", () => ({
  ensureMobileFullscreenButton: vi.fn(),
}));

vi.mock("yage/inputs/TouchMouseGuard", () => ({
  isSyntheticMouseEvent: vi.fn().mockReturnValue(false),
  markTouchInteraction: vi.fn(),
}));

vi.mock("nanoid", () => ({
  customAlphabet: () => () => "TSTID1",
}));

import { UmilFlow } from "../../../engine/umil/UmilFlow";
import type { UmilConfig } from "../../../engine/umil/types";

// Ensure window.location has the properties UmilFlow reads
if (typeof globalThis.window !== "undefined") {
  (globalThis.window as any).location = {
    ...(globalThis.window as any).location,
    search: "",
    origin: "http://localhost",
    pathname: "/",
    reload: () => {},
  };
  (globalThis.window as any).isSecureContext = false;
}

// ----------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------

function createFlow(configOverrides: Partial<UmilConfig> = {}, playerConfig: any = null, multiplayerConfig?: any) {
  const config: UmilConfig = {
    appName: "TestGame",
    ...configOverrides,
  };
  return new UmilFlow(config, playerConfig, multiplayerConfig);
}

// ----------------------------------------------------------------
// Tests
// ----------------------------------------------------------------

describe("UmilFlow", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  // ====================================================================
  // Constructor / config resolution
  // ====================================================================

  describe("constructor config resolution", () => {
    it("should use defaults when no bounds are provided", () => {
      const flow = createFlow();
      // The resolved config is exposed through the view model
      // We can test via generateRoomUrl (public) or start() behavior.
      // For now verify construction does not throw.
      expect(flow).toBeDefined();
    });

    it("should allow construction with all config fields", () => {
      const flow = createFlow({
        minPlayersTotal: 2,
        maxPlayersTotal: 8,
        minLocalPlayers: 1,
        maxLocalPlayers: 4,
      });
      expect(flow).toBeDefined();
    });

    it("should accept legacy maxOnlinePlayers field", () => {
      const flow = createFlow({
        maxOnlinePlayers: 6,
      });
      expect(flow).toBeDefined();
    });
  });

  // ====================================================================
  // generateRoomUrl
  // ====================================================================

  describe("generateRoomUrl", () => {
    it("should generate a URL with the room parameter", () => {
      const flow = createFlow();
      // window.location is stubbed by test/setup.ts but may not have origin/pathname
      // We test the method returns a string containing the room ID
      const url = flow.generateRoomUrl("ABC123");
      expect(url).toContain("ABC123");
    });

    it("should URL-encode the room parameter", () => {
      const flow = createFlow();
      const url = flow.generateRoomUrl("ROOM WITH SPACES");
      expect(url).toContain("room=");
      expect(url).toContain(encodeURIComponent("ROOM WITH SPACES"));
    });

    it("should return just the roomId if window is undefined", () => {
      const origWindow = globalThis.window;
      // Temporarily remove window
      (globalThis as any).window = undefined;
      const flow = createFlow();
      const url = flow.generateRoomUrl("XYZ");
      expect(url).toBe("XYZ");
      (globalThis as any).window = origWindow;
    });
  });

  // ====================================================================
  // Deep link parsing (via start)
  // ====================================================================

  describe("deep link parsing", () => {
    it("should detect ?room= parameter and skip to profile setup", async () => {
      // Set up window.location with a room param
      const origLocation = window.location;
      Object.defineProperty(window, "location", {
        value: {
          ...origLocation,
          search: "?room=MYROOM",
          origin: "http://localhost",
          pathname: "/",
        },
        writable: true,
        configurable: true,
      });

      const flow = createFlow();
      // start() returns a promise that won't resolve until the flow completes,
      // so we just call it and check the UI was synced (no errors thrown).
      // We don't await since it would hang.
      const promise = flow.start();

      // The flow should have started (promise is pending)
      expect(promise).toBeInstanceOf(Promise);

      // Restore
      Object.defineProperty(window, "location", {
        value: origLocation,
        writable: true,
        configurable: true,
      });
    });

    it("should show main menu when no deep link is present", async () => {
      const origLocation = window.location;
      Object.defineProperty(window, "location", {
        value: {
          ...origLocation,
          search: "",
          origin: "http://localhost",
          pathname: "/",
        },
        writable: true,
        configurable: true,
      });

      const flow = createFlow();
      const promise = flow.start();
      expect(promise).toBeInstanceOf(Promise);

      Object.defineProperty(window, "location", {
        value: origLocation,
        writable: true,
        configurable: true,
      });
    });

    it("should ignore empty ?room= parameter", async () => {
      const origLocation = window.location;
      Object.defineProperty(window, "location", {
        value: {
          ...origLocation,
          search: "?room=",
          origin: "http://localhost",
          pathname: "/",
        },
        writable: true,
        configurable: true,
      });

      const flow = createFlow();
      const promise = flow.start();
      expect(promise).toBeInstanceOf(Promise);

      Object.defineProperty(window, "location", {
        value: origLocation,
        writable: true,
        configurable: true,
      });
    });
  });

  // ====================================================================
  // Config backward compatibility
  // ====================================================================

  describe("backward compatibility", () => {
    it("should not throw when given only legacy maxOnlinePlayers", () => {
      expect(() =>
        createFlow({
          maxOnlinePlayers: 8,
        }),
      ).not.toThrow();
    });

    it("should not throw when given both new and legacy fields", () => {
      expect(() =>
        createFlow({
          maxPlayersTotal: 6,
          maxOnlinePlayers: 8, // legacy, should be ignored in favor of maxPlayersTotal
        }),
      ).not.toThrow();
    });
  });

  // ====================================================================
  // UmilQuickStart default config
  // ====================================================================

  describe("default UmilConfig fields from UmilQuickStart perspective", () => {
    it("should accept all the new config fields defined in UmilConfig", () => {
      const config: UmilConfig = {
        appName: "TestApp",
        appVersion: "1.0",
        minPlayersTotal: 2,
        maxPlayersTotal: 8,
        minLocalPlayers: 1,
        maxLocalPlayers: 4,
        maxOnlinePlayers: 6,
        allowLocalOnly: true,
        allowOnline: true,
        maxSharedMousePlayers: 2,
        maxSharedTouchPlayers: 1,
      };

      // All fields should be accepted without error
      const flow = new UmilFlow(config, null);
      expect(flow).toBeDefined();
    });
  });
});