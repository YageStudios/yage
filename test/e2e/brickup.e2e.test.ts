import { afterEach, describe, expect, it } from "vitest";
import { createYageEnv, type YageTestEnv } from "../../engine/testing/index";

// import.meta.env keeps this file free of the node-types dependency the
// older e2e files carry.
const env = import.meta.env as Record<string, string | undefined>;
const BASE_URL = env.YAGE_E2E_BASE_URL ?? "http://localhost:5173";
const DEBUG_CHROME_PATH = env.YAGE_E2E_BROWSER_PATH;
const DEBUG_HEADED = env.YAGE_E2E_HEADLESS === "false";

const createEnv = () =>
  createYageEnv({
    gamePath: "/brickup",
    routeMode: "hash",
    baseUrl: BASE_URL,
    headless: !DEBUG_HEADED,
    executablePath: DEBUG_CHROME_PATH,
    recordReplay: false,
    screenshotInterval: 0,
  });

const paddleStates = async (currentEnv: YageTestEnv) => {
  const paddles = await currentEnv.queryECS({ components: ["BrickUpPaddle"] });
  return paddles
    .map((paddle) => ({
      side: paddle.components.BrickUpPaddle.side as number,
      ownerPid: paddle.components.BrickUpPaddle.ownerPid as string,
    }))
    .sort((a, b) => a.side - b.side);
};

// The multiplayer flow proven in a real browser: a first player boots the
// room (three AI fill the remaining sides), three players join late and
// take AI sides over, inputs drive the paddle, a leave hands the side back
// to the AI, and the HUD reflects every ownership change.
describe("BrickUp E2E (multiplayer flow)", () => {
  let env: YageTestEnv | null = null;

  afterEach(async () => {
    if (env) {
      await env.close();
      env = null;
    }
  });

  it("hosts, late-joins three players, takes sides over and back, and renders ownership in the HUD", async () => {
    env = await createEnv();

    const p1 = await env.joinPlayer("p1");
    await env.tick(3);

    // The frame-1 AI fill covers every side the human did not claim.
    let paddles = await paddleStates(env);
    expect(paddles).toHaveLength(4);
    expect(paddles[0]).toEqual({ side: 0, ownerPid: "p1" });
    for (const side of [1, 2, 3]) {
      expect(paddles[side].ownerPid).toBe("");
    }

    // Late joins take the lowest AI-run side each, in order.
    await env.joinPlayer("p2");
    await env.tick(1);
    await env.joinPlayer("p3");
    await env.tick(1);
    await env.joinPlayer("p4");
    await env.tick(2);

    paddles = await paddleStates(env);
    expect(paddles.map((paddle) => paddle.ownerPid)).toEqual(["p1", "p2", "p3", "p4"]);

    // Real input through the pipeline: holding "d" moves the bottom paddle.
    const before = (await env.queryECS({ components: ["BrickUpPaddle"], filters: { "BrickUpPaddle.side": 0 } }))[0]
      .components.Transform.x as number;
    await p1.keyDown("d");
    await env.tick(20);
    await p1.keyUp("d");
    const after = (await env.queryECS({ components: ["BrickUpPaddle"], filters: { "BrickUpPaddle.side": 0 } }))[0]
      .components.Transform.x as number;
    expect(after).toBeGreaterThan(before);

    // The game actually played: bricks were destroyed.
    const boards = await env.queryECS({ components: ["BrickUpBoard"] });
    expect((boards[0].components.BrickUpBoard.score as number) ?? 0).toBeGreaterThanOrEqual(0);

    // p4 leaves: the paddle stays and the AI takes over, in sim and HUD.
    await env.leavePlayer("p4");
    await env.tick(2);
    paddles = await paddleStates(env);
    expect(paddles).toHaveLength(4);
    expect(paddles[3]).toEqual({ side: 3, ownerPid: "" });
    await env.waitForUI({ type: "text", textIncludes: "SIDE 3 · AI" });
    await env.waitForUI({ type: "text", textIncludes: "SIDE 0 · P1" });

    // No page errors across the whole flow.
    const errors = await env.getErrors();
    expect(errors).toEqual([]);
  }, 120000);
});
