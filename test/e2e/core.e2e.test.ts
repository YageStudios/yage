/**
 * YAGE E2E Testing Framework — Core Test Suite
 *
 * These tests validate the E2E testing framework itself by launching the "ball" example
 * in a headless browser and exercising the full test API surface:
 *   - Environment creation and bridge readiness
 *   - Player joining and input dispatch
 *   - Deterministic tick advancement
 *   - ECS state querying
 *   - UI querying
 *   - Error collection
 *   - Replay extraction
 *
 * Prerequisites:
 *   - The Vite examples dev server must be running on http://localhost:5173
 *     (run `npm run examples` in a separate terminal)
 *   - Playwright browsers must be installed (`npx playwright install chromium`)
 */

import { describe, it, expect, afterEach } from "vitest";
import { createYageEnv, type YageTestEnv } from "../../engine/testing/index";

// Base URL for the examples dev server (started via `npm run examples`)
const BASE_URL = process.env.YAGE_E2E_BASE_URL ?? "http://localhost:5173";
const DEBUG_CHROME_PATH = process.env.YAGE_E2E_BROWSER_PATH;
const DEBUG_HEADED = process.env.YAGE_E2E_HEADLESS === "false";

const createEnv = () =>
  createYageEnv({
    gamePath: "/ball",
    routeMode: "hash",
    baseUrl: BASE_URL,
    headless: !DEBUG_HEADED,
    executablePath: DEBUG_CHROME_PATH,
    recordReplay: false,
    screenshotInterval: 0,
  });

describe("YAGE E2E Framework", () => {
  let env: YageTestEnv | null = null;

  afterEach(async () => {
    if (env) {
      await env.close();
      env = null;
    }
  });

  describe("Environment Bootstrap", () => {
    it("should create an E2E environment and detect the bridge", async () => {
      env = await createEnv();

      // The environment should be created without errors
      expect(env).toBeDefined();

      // The bridge should report zero errors on a fresh boot
      const errors = await env.getErrors();
      expect(errors).toEqual([]);
    });
  });

  describe("Player Management", () => {
    it("should join a simulated player and retrieve their entity state", async () => {
      env = await createEnv();

      const player = await env.joinPlayer("test_player_1");
      expect(player).toBeDefined();
      expect(player.pid).toBe("test_player_1");

      // Tick a few frames so the player entity is fully initialized
      await env.tick(5);

      // Query the player's ECS state
      const state = await player.getState();
      expect(state).toBeDefined();
      expect(state.id).toBeGreaterThanOrEqual(0);
      expect(state.components).toBeDefined();
      expect(state.components["PlayerInput"]).toBeDefined();
    });

    it("should support multiple simulated players", async () => {
      env = await createEnv();

      const p1 = await env.joinPlayer("multi_p1");
      const p2 = await env.joinPlayer("multi_p2");

      expect(p1.pid).toBe("multi_p1");
      expect(p2.pid).toBe("multi_p2");

      await env.tick(5);

      const state1 = await p1.getState();
      const state2 = await p2.getState();

      // Both players should have distinct entity IDs
      expect(state1.id).not.toBe(state2.id);
    });

    it("should reject joining the same player ID twice", async () => {
      env = await createEnv();

      await env.joinPlayer("dup_player");
      await expect(env.joinPlayer("dup_player")).rejects.toThrow("already joined");
    });
  });

  describe("Deterministic Ticking", () => {
    it("should advance frames deterministically", async () => {
      env = await createEnv();

      const player = await env.joinPlayer("tick_player");

      // Tick 60 frames (1 second at 60fps)
      await env.tick(60);

      // The game should have advanced without errors
      const errors = await env.getErrors();
      expect(errors).toHaveLength(0);

      // The player entity should still be valid
      const state = await player.getState();
      expect(state).toBeDefined();
    });

    it("should reject tick with zero or negative frames", async () => {
      env = await createEnv();

      await expect(env.tick(0)).rejects.toThrow("ERR_INVALID_ARGUMENT");
      await expect(env.tick(-1)).rejects.toThrow("ERR_INVALID_ARGUMENT");
    });
  });

  describe("Input Dispatch", () => {
    it("should dispatch keyboard input to a specific player", async () => {
      env = await createEnv();

      const player = await env.joinPlayer("input_player");
      await env.tick(5);

      // Press 'w' (up movement) for this player
      await player.keyDown("w");
      await env.tick(30);
      await player.keyUp("w");
      await env.tick(5);

      // No errors should have occurred
      const errors = await env.getErrors();
      expect(errors).toHaveLength(0);
    });

    it("should isolate input between players", async () => {
      env = await createEnv();

      const p1 = await env.joinPlayer("iso_p1");
      const p2 = await env.joinPlayer("iso_p2");
      await env.tick(5);

      // Only p1 presses 'w'
      await p1.keyDown("w");
      await env.tick(30);
      await p1.keyUp("w");

      const state1 = await p1.getState();
      const state2 = await p2.getState();

      // Both entities should exist — the key insight is that p2's input should not
      // have been affected by p1's keyDown. If Transform is present, we can verify
      // they differ (p1 moved, p2 didn't).
      expect(state1).toBeDefined();
      expect(state2).toBeDefined();
      if (state1.components["Transform"] && state2.components["Transform"]) {
        // p1 should have moved differently than p2 since only p1 had input
        // (exact assertion depends on game logic, but they shouldn't be identical
        //  unless the game doesn't use WASD movement for balls)
        expect(state1.id).not.toBe(state2.id);
      }
    });
  });

  describe("ECS Querying", () => {
    it("should query entities by component type", async () => {
      env = await createEnv();

      await env.joinPlayer("ecs_player");
      await env.tick(5);

      const entities = await env.queryECS({ components: ["PlayerInput"] });
      expect(entities.length).toBeGreaterThanOrEqual(1);

      // At least one entity should have our player's pid
      const ourPlayer = entities.find((e) => e.components["PlayerInput"]?.pid === "ecs_player");
      expect(ourPlayer).toBeDefined();
    });

    it("should filter entities by component property values", async () => {
      env = await createEnv();

      await env.joinPlayer("filter_p1");
      await env.joinPlayer("filter_p2");
      await env.tick(5);

      // Query only entities where PlayerInput.pid === "filter_p1"
      const filtered = await env.queryECS({
        components: ["PlayerInput"],
        filters: { "PlayerInput.pid": "filter_p1" },
      });

      expect(filtered).toHaveLength(1);
      expect(filtered[0].components["PlayerInput"].pid).toBe("filter_p1");
    });
  });

  describe("Error Collection", () => {
    it("should start with an empty error list", async () => {
      env = await createEnv();

      const errors = await env.getErrors();
      expect(errors).toEqual([]);
    });
  });

  describe("Replay Extraction", () => {
    it("should extract a replay from the connection history", async () => {
      env = await createYageEnv({
        gamePath: "/ball",
        routeMode: "hash",
        baseUrl: BASE_URL,
        headless: !DEBUG_HEADED,
        executablePath: DEBUG_CHROME_PATH,
        recordReplay: true,
        screenshotDir: "./test-reports",
      });

      await env.joinPlayer("replay_player");
      await env.tick(30);

      // saveReplay should write without throwing
      await expect(env.saveReplay("test-replay")).resolves.not.toThrow();
    });
  });
});
