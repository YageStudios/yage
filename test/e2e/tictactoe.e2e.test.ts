import { afterEach, describe, expect, it } from "vitest";
import { createYageEnv, type YageTestEnv } from "../../engine/testing/index";

const BASE_URL = process.env.YAGE_E2E_BASE_URL ?? "http://localhost:5173";
const DEBUG_CHROME_PATH = process.env.YAGE_E2E_BROWSER_PATH;
const DEBUG_HEADED = process.env.YAGE_E2E_HEADLESS === "false";

const createEnv = () =>
  createYageEnv({
    gamePath: "/tictactoe",
    routeMode: "hash",
    baseUrl: BASE_URL,
    headless: !DEBUG_HEADED,
    executablePath: DEBUG_CHROME_PATH,
    recordReplay: false,
    screenshotInterval: 0,
  });

describe("TicTacToe E2E", () => {
  let env: YageTestEnv | null = null;

  afterEach(async () => {
    if (env) {
      await env.close();
      env = null;
    }
  });

  it("plays a full round where X wins across the top row", async () => {
    env = await createEnv();

    const xPlayer = await env.joinPlayer("ttt_x");
    const oPlayer = await env.joinPlayer("ttt_o");

    await env.tick(5);
    await env.waitForUI({ type: "text", textIncludes: "Turn: X" });

    const cells = (await env.queryUI({ type: "button" })).filter((element) => element.text !== "Restart Game");
    expect(cells).toHaveLength(9);

    await xPlayer.clickUI(cells[0].id);
    await env.tick(1);
    await env.waitForUI({ type: "text", textIncludes: "Turn: O" });

    await oPlayer.clickUI(cells[3].id);
    await env.tick(1);
    await env.waitForUI({ type: "text", textIncludes: "Turn: X" });

    await xPlayer.clickUI(cells[1].id);
    await env.tick(1);
    await env.waitForUI({ type: "text", textIncludes: "Turn: O" });

    await oPlayer.clickUI(cells[4].id);
    await env.tick(1);
    await env.waitForUI({ type: "text", textIncludes: "Turn: X" });

    await xPlayer.clickUI(cells[2].id);
    await env.tick(1);

    await env.waitForUI({ type: "text", textIncludes: "X Wins!" });

    await env.waitForUI({ type: "button", textIncludes: "Restart Game" });
    const resetButtons = await env.queryUI({ type: "button", textIncludes: "Restart Game" });
    expect(resetButtons).toHaveLength(1);

    const gameState = await env.queryECS({
      components: ["TicTacToeState"],
    });
    expect(gameState).toHaveLength(1);
    expect(gameState[0].components["TicTacToeState"].cells).toEqual(["X", "X", "X", "O", "O", "", "", "", ""]);
    expect(gameState[0].components["TicTacToeState"].status).toBe("X_WINS");
    expect(gameState[0].components["TicTacToeState"].turn).toBe("X");

    expect(await env.getErrors()).toEqual([]);
  });
});
