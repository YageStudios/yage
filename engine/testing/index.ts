/**
 * YAGE E2E Testing Framework
 *
 * Provides a Node.js-based test environment that orchestrates a headless PixiJS/YAGE engine
 * via Playwright. Allows developers to spawn simulated players, navigate UI, transition
 * between scenes, tick the game loop deterministically, extract ECS state, capture screenshots,
 * collect runtime errors, and output .yagereplay playback files.
 *
 * Usage:
 * ```typescript
 * import { test, expect } from "vitest";
 * import { createYageEnv } from "yage/testing";
 *
 * test("My E2E Test", async () => {
 *   const env = await createYageEnv({ gamePath: "/examples/socket" });
 *   await env.waitForScene("BallLobby");
 *   const p1 = await env.joinPlayer("player_1");
 *   await env.tick(60);
 *   const state = await p1.getState();
 *   expect(state.components.Transform.y).toBeLessThan(0);
 *   await env.close();
 * });
 * ```
 */

import type { Browser, BrowserContext, Page } from "playwright-core";
import { chromium } from "playwright-core";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { join, resolve } from "path";

// Re-export types from E2EBridge for use in Node.js tests
export type { SerializedUIElement, SerializedEntityState, UIQuery, ECSQuery, TickResult } from "./E2EBridge";
import type { SerializedUIElement, SerializedEntityState, UIQuery, ECSQuery, TickResult } from "./E2EBridge";

// ============================================================================
// Configuration Types
// ============================================================================

export interface TestEnvironmentConfig {
  /** URL path to load (e.g., "/examples/reball"). */
  gamePath: string;
  /** How gamePath should be applied to the base URL. */
  routeMode?: "path" | "hash";
  /** RNG seed forced into QuickStart. */
  seed?: string;
  /** Frames between automatic screenshots. 0 = disabled. */
  screenshotInterval?: number;
  /** Output directory for screenshots and replays. */
  screenshotDir?: string;
  /** Whether to record a ReplayStack for .yagereplay output. */
  recordReplay?: boolean;
  /** Launch browser visibly if false. */
  headless?: boolean;
  /** Launch a branded browser channel like Chrome instead of bundled Chromium. */
  browserChannel?: "chrome" | "msedge";
  /** Launch a specific local browser executable directly. */
  executablePath?: string;
  /** Open browser devtools when launching headed for local debugging. */
  devtools?: boolean;
  /** Slow down browser operations for visible debugging sessions. */
  slowMo?: number;
  /** Base URL of the Vite dev server. */
  baseUrl?: string;
  /** Timeout in ms for browser boot and navigation. */
  bootTimeout?: number;
}

type ResolvedTestEnvironmentConfig = Omit<
  Required<TestEnvironmentConfig>,
  "browserChannel" | "executablePath"
> & {
  browserChannel?: "chrome" | "msedge";
  executablePath?: string;
};

// ============================================================================
// Error Constants
// ============================================================================

const YAGE_E2E_TIMEOUT = (timeout: number, what: string, current?: string) =>
  `YAGE_E2E_TIMEOUT: Timeout of ${timeout}ms exceeded waiting for ${what}.${current ? ` Current: '${current}'` : ""}`;

const YAGE_E2E_UI_NOT_FOUND = (query: UIQuery) =>
  `YAGE_E2E_UI_NOT_FOUND: Could not find UI element matching query: ${JSON.stringify(query)}`;

const YAGE_E2E_ENGINE_CRASH = (frame: number, error: string) =>
  `YAGE_E2E_ENGINE_CRASH: Engine crashed during tick ${frame}. Unhandled exception: ${error}`;

const parseBooleanEnv = (value: string | undefined): boolean | undefined => {
  if (value == null) {
    return undefined;
  }

  const normalized = value.trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) {
    return true;
  }
  if (["0", "false", "no", "off"].includes(normalized)) {
    return false;
  }

  return undefined;
};

const buildTestUrl = (baseUrl: string, gamePath: string, routeMode: "path" | "hash", seed: string): string => {
  const url = new URL(baseUrl);
  url.searchParams.set("e2e", "true");
  url.searchParams.set("seed", seed);

  if (routeMode === "hash") {
    const hashPath = gamePath.replace(/^\/+/, "");
    url.hash = hashPath.length > 0 ? `#${hashPath}` : "";
    return url.toString();
  }

  const basePath = url.pathname.endsWith("/") ? url.pathname.slice(0, -1) : url.pathname;
  const nextPath = gamePath.startsWith("/") ? gamePath : `/${gamePath}`;
  url.pathname = `${basePath}${nextPath}` || "/";
  return url.toString();
};

// ============================================================================
// PlayerController
// ============================================================================

/**
 * Controls a single simulated player in the E2E test environment.
 * Provides input injection and state querying scoped to one player entity.
 */
export class PlayerController {
  public readonly pid: string;
  private readonly inputIndex: number;
  private readonly page: Page;
  private readonly env: YageTestEnv;

  constructor(pid: string, inputIndex: number, page: Page, env: YageTestEnv) {
    this.pid = pid;
    this.inputIndex = inputIndex;
    this.page = page;
    this.env = env;
  }

  /**
   * Simulate a key down event for this player.
   */
  async keyDown(key: string): Promise<void> {
    await this.page.evaluate(
      ({ pid, key }) => {
        (window as any).__YAGE_E2E__.executeCommand("DISPATCH_INPUT", [pid, key, true, "KEYBOARD"]);
      },
      { pid: this.pid, key },
    );
  }

  /**
   * Simulate a key up event for this player.
   */
  async keyUp(key: string): Promise<void> {
    await this.page.evaluate(
      ({ pid, key }) => {
        (window as any).__YAGE_E2E__.executeCommand("DISPATCH_INPUT", [pid, key, false, "KEYBOARD"]);
      },
      { pid: this.pid, key },
    );
  }

  /**
   * Simulate a touch start at the given coordinates for this player.
   */
  async touchStart(x: number, y: number): Promise<void> {
    // Touch events are mapped as movement keys based on position relative to center
    await this.page.evaluate(
      ({ pid, x, y }) => {
        (window as any).__YAGE_E2E__.executeCommand("DISPATCH_INPUT", [pid, `touch:${x}:${y}`, true, "TOUCH"]);
      },
      { pid: this.pid, x, y },
    );
  }

  /**
   * Simulate a touch end for this player.
   */
  async touchEnd(): Promise<void> {
    await this.page.evaluate(
      ({ pid }) => {
        (window as any).__YAGE_E2E__.executeCommand("DISPATCH_INPUT", [pid, "touch:end", false, "TOUCH"]);
      },
      { pid: this.pid },
    );
  }

  /**
   * Click a UI element as this player.
   * Accepts either a UI element ID (string) or a UIQuery to auto-resolve.
   */
  async clickUI(elementIdOrQuery: string | UIQuery): Promise<void> {
    let elementId: string;

    if (typeof elementIdOrQuery === "string") {
      elementId = elementIdOrQuery;
    } else {
      // Resolve the query to find the element
      const elements = await this.env.queryUI(elementIdOrQuery);
      if (elements.length === 0) {
        throw new Error(YAGE_E2E_UI_NOT_FOUND(elementIdOrQuery));
      }
      elementId = elements[0].id;
    }

    // Get element bounds and synthesize a click at the center
    await this.page.evaluate(
      ({ elementId, playerIndex }) => {
        const bridge = (window as any).__YAGE_E2E__;
        const elements = bridge.executeCommand("QUERY_UI", [{ id: elementId }]);
        if (!elements || elements.length === 0) {
          throw new Error(`UI element '${elementId}' not found`);
        }
        const element = elements[0];
        const centerX = element.bounds[0] + element.bounds[2] / 2;
        const centerY = element.bounds[1] + element.bounds[3] / 2;

        // Dispatch a synthetic mouse click via the UIService
        const uiService = (window as any).__YAGE__?.UIService;
        if (uiService) {
          const uiElement = uiService.mappedIds[elementId];
          if (uiElement) {
            uiElement.onClick(playerIndex);
          }
        }
      },
      { elementId, playerIndex: this.inputIndex },
    );
  }

  /**
   * Get the full serialized ECS state for this player's entity.
   * Looks up the entity by its PlayerInput.pid component value.
   */
  async getState(): Promise<SerializedEntityState> {
    const results = await this.env.queryECS({
      components: ["PlayerInput"],
      filters: { "PlayerInput.pid": this.pid },
    });

    if (results.length === 0) {
      throw new Error(`ERR_NOT_FOUND: Entity for player '${this.pid}' not found`);
    }

    // Re-fetch with all components for the found entity
    return this.page.evaluate(
      ({ entityId }) => {
        const bridge = (window as any).__YAGE_E2E__;
        const allEntities = bridge.executeCommand("QUERY_ECS", [{ components: ["PlayerInput"] }]);
        return allEntities.find((e: any) => e.id === entityId) ?? allEntities[0];
      },
      { entityId: results[0].id },
    );
  }
}

// ============================================================================
// YageTestEnv
// ============================================================================

/**
 * The main E2E test environment. Manages the headless browser, game engine lifecycle,
 * and provides the fluent API for writing E2E tests.
 */
export class YageTestEnv {
  private browser: Browser;
  private context: BrowserContext;
  private page: Page;
  private config: ResolvedTestEnvironmentConfig;
  private players: Map<string, PlayerController> = new Map();
  private screenshotCount = 0;
  private testFailed = false;

  constructor(browser: Browser, context: BrowserContext, page: Page, config: ResolvedTestEnvironmentConfig) {
    this.browser = browser;
    this.context = context;
    this.page = page;
    this.config = config;
  }

  /**
   * Join a simulated player into the game.
   * Returns a PlayerController scoped to this player.
   */
  async joinPlayer(pid: string, config?: any): Promise<PlayerController> {
    if (this.players.has(pid)) {
      throw new Error(`Player '${pid}' has already joined this E2E session`);
    }

    const inputIndex = await this.page.evaluate(
      ({ pid, config }) => {
        return (window as any).__YAGE_E2E__.executeCommand("JOIN_PLAYER", [pid, config ?? {}]);
      },
      { pid, config },
    );

    const controller = new PlayerController(pid, inputIndex, this.page, this);
    this.players.set(pid, controller);
    return controller;
  }

  /**
   * Advance the game simulation by an exact number of frames.
   * Each frame is 16.6666ms (60fps). If screenshotInterval is configured,
   * screenshots will be captured at the specified intervals.
   */
  async tick(frames: number): Promise<void> {
    if (frames <= 0) {
      throw new Error("ERR_INVALID_ARGUMENT: tick() requires frames > 0");
    }

    let remaining = frames;

    while (remaining > 0) {
      const result: TickResult = await this.page.evaluate(
        ({ frames }) => {
          return (window as any).__YAGE_E2E__.executeCommand("TICK", [frames]);
        },
        { frames: remaining },
      );

      remaining -= result.framesExecuted;

      // Check for engine errors
      if (result.errors.length > 0) {
        this.testFailed = true;
        throw new Error(YAGE_E2E_ENGINE_CRASH(result.pausedAt ?? 0, result.errors.join("\n")));
      }

      // Handle screenshot capture
      if (result.requiresScreenshot && this.config.screenshotInterval > 0) {
        await this.captureScreenshot(`tick-${result.pausedAt}`);
      }
    }
  }

  /**
   * Wait for a specific Scene class to become the current scene.
   * Polls every 50ms until the scene name matches (case-insensitive).
   */
  async waitForScene(sceneName: string, options?: { timeout?: number }): Promise<void> {
    const timeout = options?.timeout ?? 5000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const currentScene: string = await this.page.evaluate(() => {
        return (window as any).__YAGE_E2E__?.executeCommand("GET_SCENE", []) ?? "";
      });

      if (currentScene.toLowerCase() === sceneName.toLowerCase()) {
        return;
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    // Final check
    const currentScene: string = await this.page.evaluate(() => {
      return (window as any).__YAGE_E2E__?.executeCommand("GET_SCENE", []) ?? "";
    });

    if (currentScene.toLowerCase() !== sceneName.toLowerCase()) {
      throw new Error(YAGE_E2E_TIMEOUT(timeout, `Scene '${sceneName}'`, currentScene));
    }
  }

  /**
   * Wait for a UI element matching the query to exist and be visible.
   * Polls every 50ms until the element is found.
   */
  async waitForUI(query: UIQuery, options?: { timeout?: number }): Promise<SerializedUIElement> {
    const timeout = options?.timeout ?? 5000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeout) {
      const elements = await this.queryUI(query);
      const visible = elements.filter((e) => e.visible);
      if (visible.length > 0) {
        return visible[0];
      }

      await new Promise((resolve) => setTimeout(resolve, 50));
    }

    throw new Error(YAGE_E2E_TIMEOUT(timeout, `UI element matching ${JSON.stringify(query)}`));
  }

  /**
   * Query all currently active UI elements matching the given query.
   */
  async queryUI(query: UIQuery): Promise<SerializedUIElement[]> {
    return this.page.evaluate(
      ({ query }) => {
        return (window as any).__YAGE_E2E__.executeCommand("QUERY_UI", [query]);
      },
      { query },
    );
  }

  /**
   * Query ECS entities by component types and optional filters.
   */
  async queryECS(query: ECSQuery): Promise<SerializedEntityState[]> {
    return this.page.evaluate(
      ({ query }) => {
        return (window as any).__YAGE_E2E__.executeCommand("QUERY_ECS", [query]);
      },
      { query },
    );
  }

  /**
   * Retrieve all trapped errors from the browser engine.
   */
  async getErrors(): Promise<string[]> {
    return this.page.evaluate(() => {
      return (window as any).__YAGE_E2E__.executeCommand("GET_ERRORS", []);
    });
  }

  /**
   * Extract and save the replay stack to a JSON file.
   */
  async saveReplay(filename: string): Promise<void> {
    const replay = await this.page.evaluate(() => {
      return (window as any).__YAGE_E2E__.executeCommand("EXTRACT_REPLAY", []);
    });

    const dir = resolve(this.config.screenshotDir);
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    const filePath = join(dir, filename.endsWith(".json") ? filename : `${filename}.json`);
    writeFileSync(filePath, JSON.stringify(replay, null, 2), "utf-8");
  }

  /**
   * Capture a screenshot of the current page state.
   */
  private async captureScreenshot(label: string): Promise<void> {
    const dir = resolve(this.config.screenshotDir, "screenshots");
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }

    this.screenshotCount++;
    const filePath = join(dir, `${label}-${this.screenshotCount}.png`);

    await this.page.screenshot({ path: filePath, fullPage: true });
  }

  /**
   * Shut down the test environment.
   * Automatically saves a replay if the test failed and recordReplay is enabled.
   */
  async close(): Promise<void> {
    try {
      // Auto-save replay on failure (or always if configured)
      if (this.config.recordReplay) {
        const errors = await this.getErrors();
        if (errors.length > 0 || this.testFailed) {
          await this.saveReplay("failed-test-replay");
        }
      }
    } catch {
      // Ignore errors during cleanup
    }

    try {
      await this.context.close();
    } catch {
      // Context may already be closed
    }

    try {
      await this.browser.close();
    } catch {
      // Browser may already be closed
    }
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create a new E2E test environment.
 *
 * Launches a headless Chromium browser via Playwright, navigates to the game URL
 * with `?e2e=true`, and waits for the E2EBridge to signal readiness.
 *
 * @param config - Test environment configuration
 * @returns A ready-to-use YageTestEnv instance
 */
export async function createYageEnv(config: TestEnvironmentConfig): Promise<YageTestEnv> {
  const envHeadless = parseBooleanEnv(process.env.YAGE_E2E_HEADLESS);
  const envDevtools = parseBooleanEnv(process.env.YAGE_E2E_DEVTOOLS);
  const envSlowMo = process.env.YAGE_E2E_SLOWMO ? Number(process.env.YAGE_E2E_SLOWMO) : undefined;
  const browserChannel = (config.browserChannel ?? process.env.YAGE_E2E_BROWSER_CHANNEL) as
    | "chrome"
    | "msedge"
    | undefined;
  const executablePath = config.executablePath ?? process.env.YAGE_E2E_BROWSER_PATH;
  const resolvedConfig: ResolvedTestEnvironmentConfig = {
    gamePath: config.gamePath,
    routeMode: config.routeMode ?? "path",
    seed: config.seed ?? "e2e-seed",
    screenshotInterval: config.screenshotInterval ?? 0,
    screenshotDir: config.screenshotDir ?? "./reports",
    recordReplay: config.recordReplay ?? true,
    headless: config.headless ?? envHeadless ?? true,
    browserChannel,
    executablePath,
    devtools: config.devtools ?? envDevtools ?? false,
    slowMo: config.slowMo ?? envSlowMo ?? 0,
    baseUrl: config.baseUrl ?? "http://localhost:3000",
    bootTimeout: config.bootTimeout ?? 30000,
  };

  // Launch browser
  const browser = await chromium.launch({
    headless: resolvedConfig.headless,
    channel: resolvedConfig.executablePath ? undefined : resolvedConfig.browserChannel,
    executablePath: resolvedConfig.executablePath,
    devtools: resolvedConfig.devtools,
    slowMo: resolvedConfig.slowMo,
    args: [
      "--disable-web-security",
      "--disable-features=IsolateOrigins,site-per-process",
      "--no-sandbox",
      "--disable-setuid-sandbox",
      "--disable-gpu",
    ],
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    ignoreHTTPSErrors: true,
  });

  const page = await context.newPage();

  // Collect browser console errors
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.error(`[BROWSER ERROR] ${msg.text()}`);
    } else if (msg.type() === "warning") {
      console.warn(`[BROWSER WARN] ${msg.text()}`);
    }
  });
  page.on("pageerror", (error) => {
    console.error(`[BROWSER PAGE ERROR] ${error.stack || error.message}`);
  });
  page.on("requestfailed", (request) => {
    console.error(`[BROWSER REQUEST FAILED] ${request.method()} ${request.url()} ${request.failure()?.errorText ?? ""}`.trim());
  });

  // Navigate to the game with E2E flag
  const url = buildTestUrl(
    resolvedConfig.baseUrl,
    resolvedConfig.gamePath,
    resolvedConfig.routeMode,
    resolvedConfig.seed,
  );
  await page.goto(url, {
    timeout: resolvedConfig.bootTimeout,
    waitUntil: "load",
  });

  // Wait for the E2EBridge to signal readiness
  await page.waitForFunction(() => (window as any).__YAGE_E2E__?.ready === true, {
    timeout: resolvedConfig.bootTimeout,
  });

  // Configure screenshot interval if set
  if (resolvedConfig.screenshotInterval > 0) {
    await page.evaluate(
      ({ interval }) => {
        (window as any).__YAGE_E2E__.executeCommand("SET_SCREENSHOT_INTERVAL", [interval]);
      },
      { interval: resolvedConfig.screenshotInterval },
    );
  }

  return new YageTestEnv(browser, context, page, resolvedConfig);
}
