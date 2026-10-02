import type { LaunchOptions } from "playwright-core";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const browser = vi.hoisted(() => {
  const page = { on: vi.fn(), goto: vi.fn(), waitForFunction: vi.fn() };
  const context = { newPage: vi.fn(async () => page) };
  return { page, launch: vi.fn<(options: LaunchOptions) => unknown>(async () => ({ newContext: vi.fn(async () => context) })) };
});
vi.mock("playwright-core", () => ({ chromium: { launch: browser.launch } }));

import { createYageEnv } from "../../engine/testing/index";

describe("E2E browser launch compatibility", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const name of ["HEADLESS", "DEVTOOLS", "SLOWMO", "BROWSER_CHANNEL", "BROWSER_PATH"]) {
      vi.stubEnv(`YAGE_E2E_${name}`, "");
    }
  });
  afterEach(() => vi.unstubAllEnvs());

  it("boots a headless game without opening developer tools by default", async () => {
    await createYageEnv({ gamePath: "/ball" });
    const options = browser.launch.mock.calls[0]?.[0];
    expect(options).toMatchObject({ headless: true });
    expect(options).not.toHaveProperty("devtools");
    expect(options?.args).not.toContain("--auto-open-devtools-for-tabs");
    expect(browser.page.goto).toHaveBeenCalledWith(
      "http://localhost:3000/ball?e2e=true&seed=e2e-seed",
      { timeout: 30000, waitUntil: "load" },
    );
    expect(browser.page.waitForFunction).toHaveBeenCalledOnce();
  });

  it("opens developer tools for explicitly requested debugging with a custom browser", async () => {
    await createYageEnv({ gamePath: "/ball", headless: false, devtools: true, executablePath: "/browser", browserChannel: "chrome" });
    const options = browser.launch.mock.calls[0]?.[0];
    expect(options).toMatchObject({ headless: false, executablePath: "/browser", channel: undefined });
    expect(options).not.toHaveProperty("devtools");
    expect(options?.args?.filter((value: string) => value === "--auto-open-devtools-for-tabs")).toHaveLength(1);
  });

  it("accepts the existing environment opt-in for developer tools", async () => {
    vi.stubEnv("YAGE_E2E_DEVTOOLS", "true");
    await createYageEnv({ gamePath: "/ball" });
    expect(browser.launch.mock.calls[0]?.[0]?.args).toContain("--auto-open-devtools-for-tabs");
  });

  it("lets explicit configuration disable an environment debug opt-in", async () => {
    vi.stubEnv("YAGE_E2E_DEVTOOLS", "true");
    await createYageEnv({ gamePath: "/ball", devtools: false });
    expect(browser.launch.mock.calls[0]?.[0]?.args).not.toContain("--auto-open-devtools-for-tabs");
  });
});
