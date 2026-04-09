import { describe, it, expect, vi, beforeEach } from "vitest";
import { InputClusterer } from "../../../engine/umil/InputClusterer";
import { InputEventType, InputManager } from "../../../engine/inputs/InputManager";
import { UmilInputType } from "../../../engine/umil/types";
import type { UMIL_LocalPlayerConfig } from "../../../engine/umil/types";

/**
 * Creates a minimal InputManager with a controllable key listener.
 * Calling the returned `simulateKey` fires the registered listener.
 */
function createMockInputManager() {
  let listener: ((key: string, pressed: boolean, eventType: InputEventType, typeIndex: number) => void) | null = null;

  const inputManager = {
    addKeyListener: vi.fn((cb: typeof listener) => {
      listener = cb;
      return () => {
        listener = null;
      };
    }),
    dispatchEvent: vi.fn(),
  } as unknown as InputManager;

  const simulateKey = (key: string, pressed: boolean, eventType: InputEventType, typeIndex = 0) => {
    listener?.(key, pressed, eventType, typeIndex);
  };

  return { inputManager, simulateKey };
}

describe("InputClusterer", () => {
  let inputManager: InputManager;
  let simulateKey: ReturnType<typeof createMockInputManager>["simulateKey"];
  let onJoin: ReturnType<typeof vi.fn>;
  let onLeave: ReturnType<typeof vi.fn>;
  let clusterer: InputClusterer;

  beforeEach(() => {
    ({ inputManager, simulateKey } = createMockInputManager());
    onJoin = vi.fn();
    onLeave = vi.fn();
  });

  // ====================================================================
  // Explicit detection mode
  // ====================================================================

  describe("startExplicitDetection", () => {
    beforeEach(() => {
      clusterer = new InputClusterer(inputManager, 4, onJoin);
      clusterer.startExplicitDetection(4, onJoin, onLeave);
    });

    it("should register a key listener on the InputManager", () => {
      expect(inputManager.addKeyListener).toHaveBeenCalled();
    });

    it("should add a player when Enter is pressed (keyboard)", () => {
      simulateKey("enter", true, InputEventType.KEYBOARD, 0);
      expect(onJoin).toHaveBeenCalledTimes(1);
      const config: UMIL_LocalPlayerConfig = onJoin.mock.calls[0][0];
      expect(config.localIndex).toBe(0);
      expect(config.inputType).toBe(UmilInputType.KEYBOARD);
    });

    it("should add a player when Space is pressed (keyboard)", () => {
      simulateKey("space", true, InputEventType.KEYBOARD, 0);
      expect(onJoin).toHaveBeenCalledTimes(1);
      expect(onJoin.mock.calls[0][0].inputType).toBe(UmilInputType.KEYBOARD);
    });

    it("should add a player when gamepad A button (0) is pressed", () => {
      simulateKey("0", true, InputEventType.GAMEPAD, 0);
      expect(onJoin).toHaveBeenCalledTimes(1);
      const config: UMIL_LocalPlayerConfig = onJoin.mock.calls[0][0];
      expect(config.inputType).toBe(UmilInputType.GAMEPAD);
      expect(config.inputIndex).toBe(0);
    });

    it("should add a player when the mouse is clicked", () => {
      simulateKey("click", true, InputEventType.MOUSE, 0);
      expect(onJoin).toHaveBeenCalledTimes(1);
      expect(onJoin.mock.calls[0][0].inputType).toBe(UmilInputType.MOUSE);
    });

    it("should add a player when the screen is tapped", () => {
      simulateKey("tap", true, InputEventType.TOUCH, 0);
      expect(onJoin).toHaveBeenCalledTimes(1);
      expect(onJoin.mock.calls[0][0].inputType).toBe(UmilInputType.TOUCH);
    });

    it("should NOT add a player for arbitrary keys", () => {
      simulateKey("a", true, InputEventType.KEYBOARD, 0);
      simulateKey("w", true, InputEventType.KEYBOARD, 0);
      simulateKey("1", true, InputEventType.GAMEPAD, 0);
      expect(onJoin).not.toHaveBeenCalled();
    });

    it("should NOT add a player on key release (pressed=false)", () => {
      simulateKey("enter", false, InputEventType.KEYBOARD, 0);
      expect(onJoin).not.toHaveBeenCalled();
    });

    it("should remove a player when Escape is pressed", () => {
      // First join
      simulateKey("enter", true, InputEventType.KEYBOARD, 0);
      expect(onJoin).toHaveBeenCalledTimes(1);

      // Then leave
      simulateKey("escape", true, InputEventType.KEYBOARD, 0);
      expect(onLeave).toHaveBeenCalledTimes(1);
      expect(onLeave).toHaveBeenCalledWith(0);
    });

    it("should remove a player when gamepad B button (1) is pressed", () => {
      // Join with gamepad A
      simulateKey("0", true, InputEventType.GAMEPAD, 1);
      expect(onJoin).toHaveBeenCalledTimes(1);

      // Leave with gamepad B on same gamepad
      simulateKey("1", true, InputEventType.GAMEPAD, 1);
      expect(onLeave).toHaveBeenCalledTimes(1);
    });

    it("should NOT remove a player that does not exist", () => {
      simulateKey("escape", true, InputEventType.KEYBOARD, 0);
      expect(onLeave).not.toHaveBeenCalled();
    });

    it("should cap players at maxLocalPlayers", () => {
      clusterer.stop();
      clusterer.startExplicitDetection(2, onJoin, onLeave);

      simulateKey("enter", true, InputEventType.KEYBOARD, 0);
      simulateKey("0", true, InputEventType.GAMEPAD, 0);
      simulateKey("0", true, InputEventType.GAMEPAD, 1); // should be ignored
      expect(onJoin).toHaveBeenCalledTimes(2);
      expect(clusterer.getPlayers()).toHaveLength(2);
    });

    it("should not allow the same device to join twice", () => {
      simulateKey("enter", true, InputEventType.KEYBOARD, 0);
      simulateKey("enter", true, InputEventType.KEYBOARD, 0);
      expect(onJoin).toHaveBeenCalledTimes(1);
    });

    it("should allow re-joining after a player leaves", () => {
      simulateKey("enter", true, InputEventType.KEYBOARD, 0);
      expect(clusterer.getPlayers()).toHaveLength(1);

      simulateKey("escape", true, InputEventType.KEYBOARD, 0);
      expect(clusterer.getPlayers()).toHaveLength(0);

      // Re-join
      simulateKey("enter", true, InputEventType.KEYBOARD, 0);
      expect(clusterer.getPlayers()).toHaveLength(1);
      expect(onJoin).toHaveBeenCalledTimes(2);
    });

    it("should assign sequential localIndex values", () => {
      simulateKey("enter", true, InputEventType.KEYBOARD, 0);
      simulateKey("0", true, InputEventType.GAMEPAD, 0);
      const players = clusterer.getPlayers();
      expect(players[0].localIndex).toBe(0);
      expect(players[1].localIndex).toBe(1);
    });

    it("should detect keyboard clusters correctly", () => {
      // WASD cluster uses space as join key
      simulateKey("space", true, InputEventType.KEYBOARD, 0);
      const players = clusterer.getPlayers();
      expect(players[0].keyboardCluster).toBe("WASD");
    });

    it("should detect ARROWS cluster when enter is pressed", () => {
      simulateKey("enter", true, InputEventType.KEYBOARD, 0);
      const players = clusterer.getPlayers();
      expect(players[0].keyboardCluster).toBe("ARROWS");
    });

    it("should not assign a cluster to gamepad players", () => {
      simulateKey("0", true, InputEventType.GAMEPAD, 0);
      const players = clusterer.getPlayers();
      expect(players[0].keyboardCluster).toBeNull();
    });

    it("should prevent two keyboard players from the same cluster", () => {
      // Both enter and control are ARROWS cluster
      simulateKey("enter", true, InputEventType.KEYBOARD, 0);
      // Try joining again with same cluster key
      simulateKey("enter", true, InputEventType.KEYBOARD, 1);
      // The second join should fail because the ARROWS cluster is already taken
      expect(onJoin).toHaveBeenCalledTimes(1);
    });
  });

  // ====================================================================
  // getPlayers / getAssignedPlayerCount
  // ====================================================================

  describe("getPlayers", () => {
    beforeEach(() => {
      clusterer = new InputClusterer(inputManager, 4, onJoin);
      clusterer.startExplicitDetection(4, onJoin, onLeave);
    });

    it("should return an empty array when no players joined", () => {
      expect(clusterer.getPlayers()).toEqual([]);
      expect(clusterer.getAssignedPlayerCount()).toBe(0);
    });

    it("should return a copy (not a reference) of the internal array", () => {
      simulateKey("enter", true, InputEventType.KEYBOARD, 0);
      const players1 = clusterer.getPlayers();
      const players2 = clusterer.getPlayers();
      expect(players1).toEqual(players2);
      expect(players1).not.toBe(players2);
    });

    it("should reflect removals", () => {
      simulateKey("enter", true, InputEventType.KEYBOARD, 0);
      simulateKey("0", true, InputEventType.GAMEPAD, 0);
      expect(clusterer.getPlayers()).toHaveLength(2);

      clusterer.removePlayer(0);
      expect(clusterer.getPlayers()).toHaveLength(1);
      expect(clusterer.getAssignedPlayerCount()).toBe(1);
    });
  });

  // ====================================================================
  // removePlayer
  // ====================================================================

  describe("removePlayer", () => {
    beforeEach(() => {
      clusterer = new InputClusterer(inputManager, 4, onJoin);
      clusterer.startExplicitDetection(4, onJoin, onLeave);
    });

    it("should do nothing if localIndex is not found", () => {
      clusterer.removePlayer(99);
      expect(onLeave).not.toHaveBeenCalled();
    });

    it("should re-index remaining players after removal", () => {
      simulateKey("enter", true, InputEventType.KEYBOARD, 0);
      simulateKey("0", true, InputEventType.GAMEPAD, 0);
      simulateKey("0", true, InputEventType.GAMEPAD, 1);

      // Remove the first player (index 0)
      clusterer.removePlayer(0);
      const remaining = clusterer.getPlayers();
      expect(remaining).toHaveLength(2);
      expect(remaining[0].localIndex).toBe(0);
      expect(remaining[1].localIndex).toBe(1);
    });

    it("should fire the onLeave callback with the original localIndex", () => {
      simulateKey("enter", true, InputEventType.KEYBOARD, 0);
      simulateKey("0", true, InputEventType.GAMEPAD, 0);

      clusterer.removePlayer(1);
      expect(onLeave).toHaveBeenCalledWith(1);
    });

    it("should allow a new player to join after removal frees up a slot", () => {
      clusterer.stop();
      clusterer.startExplicitDetection(2, onJoin, onLeave);

      simulateKey("enter", true, InputEventType.KEYBOARD, 0);
      simulateKey("0", true, InputEventType.GAMEPAD, 0);
      expect(clusterer.getPlayers()).toHaveLength(2);

      // At cap — another join should fail
      simulateKey("0", true, InputEventType.GAMEPAD, 1);
      expect(clusterer.getPlayers()).toHaveLength(2);

      // Remove one
      clusterer.removePlayer(0);
      expect(clusterer.getPlayers()).toHaveLength(1);

      // Now a new player can join
      simulateKey("0", true, InputEventType.GAMEPAD, 1);
      expect(clusterer.getPlayers()).toHaveLength(2);
    });
  });

  // ====================================================================
  // addSharedPlayer (mouse/touch)
  // ====================================================================

  describe("addSharedPlayer", () => {
    beforeEach(() => {
      clusterer = new InputClusterer(inputManager, 4, onJoin, 2, 1);
    });

    it("should add a mouse player", () => {
      const result = clusterer.addSharedPlayer(UmilInputType.MOUSE, 0);
      expect(result).toBe(true);
      expect(onJoin).toHaveBeenCalledTimes(1);
      expect(onJoin.mock.calls[0][0].inputType).toBe(UmilInputType.MOUSE);
    });

    it("should respect maxSharedMousePlayers limit", () => {
      expect(clusterer.addSharedPlayer(UmilInputType.MOUSE, 0)).toBe(true);
      expect(clusterer.addSharedPlayer(UmilInputType.MOUSE, 0)).toBe(true); // max is 2
      expect(clusterer.addSharedPlayer(UmilInputType.MOUSE, 0)).toBe(false); // exceeds
    });

    it("should respect maxSharedTouchPlayers limit", () => {
      expect(clusterer.addSharedPlayer(UmilInputType.TOUCH, 0)).toBe(true);
      expect(clusterer.addSharedPlayer(UmilInputType.TOUCH, 0)).toBe(false); // max is 1
    });

    it("should not add a shared keyboard player", () => {
      const result = clusterer.addSharedPlayer(UmilInputType.KEYBOARD, 0);
      expect(result).toBe(false);
    });

    it("should respect overall maxLocalPlayers", () => {
      // Construct with maxLocalPlayers=3, maxSharedMouse=3, maxSharedTouch=3
      clusterer = new InputClusterer(inputManager, 3, onJoin, 3, 3);
      expect(clusterer.addSharedPlayer(UmilInputType.MOUSE, 0)).toBe(true);
      expect(clusterer.addSharedPlayer(UmilInputType.MOUSE, 0)).toBe(true);
      expect(clusterer.addSharedPlayer(UmilInputType.TOUCH, 0)).toBe(true);
      // Now at 3 players (= maxLocalPlayers) — another shared should fail
      expect(clusterer.addSharedPlayer(UmilInputType.TOUCH, 0)).toBe(false);
    });
  });

  // ====================================================================
  // Legacy mode (start)
  // ====================================================================

  describe("legacy start()", () => {
    beforeEach(() => {
      clusterer = new InputClusterer(inputManager, 4, onJoin);
      clusterer.start();
    });

    it("should add a player on any key press", () => {
      simulateKey("a", true, InputEventType.KEYBOARD, 0);
      expect(onJoin).toHaveBeenCalledTimes(1);
    });

    it("should add a gamepad player on any button press", () => {
      simulateKey("5", true, InputEventType.GAMEPAD, 0);
      expect(onJoin).toHaveBeenCalledTimes(1);
      expect(onJoin.mock.calls[0][0].inputType).toBe(UmilInputType.GAMEPAD);
    });

    it("should add a mouse player on click", () => {
      simulateKey("click", true, InputEventType.MOUSE, 0);
      expect(onJoin).toHaveBeenCalledTimes(1);
      expect(onJoin.mock.calls[0][0].inputType).toBe(UmilInputType.MOUSE);
    });

    it("should add a touch player on tap", () => {
      simulateKey("tap", true, InputEventType.TOUCH, 0);
      expect(onJoin).toHaveBeenCalledTimes(1);
      expect(onJoin.mock.calls[0][0].inputType).toBe(UmilInputType.TOUCH);
    });

    it("should not duplicate from the same device", () => {
      simulateKey("a", true, InputEventType.KEYBOARD, 0);
      simulateKey("w", true, InputEventType.KEYBOARD, 0);
      expect(onJoin).toHaveBeenCalledTimes(1);
    });

    it("should cap at maxLocalPlayers", () => {
      clusterer.stop();
      clusterer = new InputClusterer(inputManager, 2, onJoin);
      clusterer.start();

      simulateKey("a", true, InputEventType.KEYBOARD, 0);
      simulateKey("5", true, InputEventType.GAMEPAD, 0);
      simulateKey("5", true, InputEventType.GAMEPAD, 1);
      expect(onJoin).toHaveBeenCalledTimes(2);
    });
  });

  // ====================================================================
  // stop / reset / confirmInputs
  // ====================================================================

  describe("stop", () => {
    it("should stop listening for key events", () => {
      clusterer = new InputClusterer(inputManager, 4, onJoin);
      clusterer.startExplicitDetection(4, onJoin, onLeave);

      clusterer.stop();
      simulateKey("enter", true, InputEventType.KEYBOARD, 0);
      expect(onJoin).not.toHaveBeenCalled();
    });
  });

  describe("reset", () => {
    it("should clear all players and assignments", () => {
      clusterer = new InputClusterer(inputManager, 4, onJoin);
      clusterer.startExplicitDetection(4, onJoin, onLeave);

      simulateKey("enter", true, InputEventType.KEYBOARD, 0);
      simulateKey("0", true, InputEventType.GAMEPAD, 0);
      expect(clusterer.getAssignedPlayerCount()).toBe(2);

      clusterer.reset();
      expect(clusterer.getAssignedPlayerCount()).toBe(0);
      expect(clusterer.getPlayers()).toEqual([]);
    });
  });

  describe("confirmInputs", () => {
    it("should stop listening and return current players", () => {
      clusterer = new InputClusterer(inputManager, 4, onJoin);
      clusterer.startExplicitDetection(4, onJoin, onLeave);

      simulateKey("enter", true, InputEventType.KEYBOARD, 0);
      const confirmed = clusterer.confirmInputs();
      expect(confirmed).toHaveLength(1);
      expect(confirmed[0].inputType).toBe(UmilInputType.KEYBOARD);

      // After confirm, listener should be stopped
      simulateKey("0", true, InputEventType.GAMEPAD, 0);
      expect(onJoin).toHaveBeenCalledTimes(1); // only the initial join
    });
  });

  // ====================================================================
  // getAssignedTypeCount
  // ====================================================================

  describe("getAssignedTypeCount", () => {
    it("should count mouse and touch via internal counters", () => {
      clusterer = new InputClusterer(inputManager, 4, onJoin, 3, 3);
      clusterer.addSharedPlayer(UmilInputType.MOUSE, 0);
      clusterer.addSharedPlayer(UmilInputType.MOUSE, 0);
      clusterer.addSharedPlayer(UmilInputType.TOUCH, 0);
      expect(clusterer.getAssignedTypeCount(UmilInputType.MOUSE)).toBe(2);
      expect(clusterer.getAssignedTypeCount(UmilInputType.TOUCH)).toBe(1);
    });
  });
});
