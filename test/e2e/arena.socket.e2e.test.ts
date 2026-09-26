/* eslint-disable @typescript-eslint/no-explicit-any */
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright-core";

// import.meta.env keeps this file free of the node-types dependency the
// older e2e files carry.
const env = import.meta.env as Record<string, string | undefined>;
const BASE_URL = env.YAGE_E2E_BASE_URL ?? "http://localhost:5173";
const SOCKET_SERVER = env.YAGE_E2E_SOCKET_SERVER ?? "http://localhost:3001";
const DEBUG_CHROME_PATH = env.YAGE_E2E_BROWSER_PATH;
const DEBUG_HEADED = env.YAGE_E2E_HEADLESS === "false";

// Room isolated from any live arena session sharing the game server.
const ROOM = "arena-e2e";

const readPeers = (page: Page): Promise<any[]> =>
  page.evaluate(`(() => {
    const peers = [];
    for (const f of document.querySelectorAll("iframe")) {
      const conn = f.contentWindow?.__BRICKUP_CONNECTION__;
      const gm = conn?.roomStates?.[f.contentWindow.__BRICKUP_ROOM__]?.gameModel;
      if (!gm) { peers.push(null); continue; }
      const pids = gm.getComponentActives("PlayerInput")
        .map((e) => gm.getComponent("PlayerInput", e)?.pid)
        .sort();
      const owners = gm.getComponentActives("BrickUpPaddle")
        .map((e) => gm.getComponent("BrickUpPaddle", e)?.ownerPid)
        .filter((owner) => owner !== "");
      peers.push({ frame: gm.frame, pids, owners, joined: !!f.contentWindow.__BRICKUP_ROOM_JOINED__ });
    }
    return peers;
  })()`) as Promise<any[]>;

// The four-iframe arena proven over the real socket transport: every client
// converges into one shared room with all four player entities, a click on
// one client's view takes an AI side over on every client at the same frame,
// and the peers stay in lockstep while running. Requires `npm run server`
// and the Vite dev server.
describe("BrickUp arena E2E (socket multiplayer)", () => {
  let browser: Browser | null = null;
  let serverUp = false;
  let viteUp = false;

  beforeAll(async (ctx) => {
    serverUp = await fetch(`${SOCKET_SERVER}/status`)
      .then((res) => res.ok)
      .catch(() => false);
    viteUp = await fetch(BASE_URL)
      .then((res) => res.ok)
      .catch(() => false);
    if (!serverUp || !viteUp) {
      (ctx as any).skip();
    }
  });

  afterEach(async () => {
    await browser?.close();
    browser = null;
  });

  it("converges four clients into one room, propagates a click claim, and stays in lockstep", async () => {
    browser = await chromium.launch({
      headless: !DEBUG_HEADED,
      executablePath: DEBUG_CHROME_PATH,
    });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(String(error)));

    await page.goto(`${BASE_URL}/arena?room=${ROOM}`);
    await page.waitForLoadState("domcontentloaded");

    // Chained mounts boot the peers sequentially; the last one is the slowest.
    await page.waitForFunction(
      () => {
        const frames = [...document.querySelectorAll("iframe")];
        return frames.length === 4 && frames.every((f) => (f.contentWindow as any)?.__BRICKUP_ROOM_JOINED__);
      },
      undefined,
      { timeout: 90_000, polling: 500 },
    );

    // One shared room: every client's model holds all four player entities
    // (materialized joinGraceFrames after the join handshake) and the models
    // sit within a frame or two of each other.
    const expectedPids = ["player1", "player2", "player3", "player4"];
    await page.waitForFunction(
      (room) => {
        const expected = JSON.stringify(["player1", "player2", "player3", "player4"]);
        const frames = [...document.querySelectorAll("iframe")];
        return frames.every((f) => {
          const conn = (f.contentWindow as any)?.__BRICKUP_CONNECTION__;
          const gm = conn?.roomStates?.[room]?.gameModel;
          if (!gm) return false;
          const pids = (gm as any)
            .getComponentActives("PlayerInput")
            .map((e: any) => (gm as any).getComponent("PlayerInput", e)?.pid)
            .sort();
          return JSON.stringify(pids) === expected;
        });
      },
      ROOM,
      { timeout: 30_000, polling: 500 },
    );
    let peers = await readPeers(page);
    for (const peer of peers) {
      expect(peer.pids).toEqual(expectedPids);
    }
    // Peers block on missing input frames beyond one publish-ahead window,
    // so the steady-state spread is structurally capped at the frame offset.
    const frames = peers.map((peer) => peer.frame);
    expect(Math.max(...frames) - Math.min(...frames)).toBeLessThanOrEqual(8);

    // Click player2's quadrant (top-right): the claim rides the lockstep
    // input frames, so every client sees the takeover on the same frame.
    const iframe = page.locator("iframe").nth(1);
    const box = await iframe.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.click(box!.x + box!.width / 2, box!.y + box!.height / 2);

    await page.waitForFunction(
      (room) => {
        const frames2 = [...document.querySelectorAll("iframe")];
        return frames2.every((f) => {
          const gm = (f.contentWindow as any)?.__BRICKUP_CONNECTION__?.roomStates?.[room]?.gameModel;
          if (!gm) return false;
          return (gm as any)
            .getComponentActives("BrickUpPaddle")
            .some((e: any) => (gm as any).getComponent("BrickUpPaddle", e)?.ownerPid === "player2");
        });
      },
      ROOM,
      { timeout: 10_000, polling: 200 },
    );

    // Still one shared timeline while the game keeps running. Peers block on
    // missing input frames beyond one publish-ahead window, so the spread is
    // structurally capped at the frame offset (8).
    await page.waitForTimeout(2_000);
    peers = await readPeers(page);
    const runFrames = peers.map((peer) => peer.frame);
    expect(Math.max(...runFrames) - Math.min(...runFrames)).toBeLessThanOrEqual(8);
    for (const peer of peers) {
      expect(peer.owners).toContain("player2");
    }

    expect(pageErrors).toEqual([]);
  }, 150_000);
});
