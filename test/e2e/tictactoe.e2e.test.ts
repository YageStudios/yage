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

  const getBoardCells = async (currentEnv: YageTestEnv) =>
    (await currentEnv.queryUI({ type: "button" })).filter((element) => element.text !== "Restart Game");

  const countUniquePositions = (values: number[], tolerance = 5) => {
    const sorted = [...values].sort((a, b) => a - b);
    const groups: number[] = [];
    for (const value of sorted) {
      if (groups.length === 0 || Math.abs(value - groups[groups.length - 1]) > tolerance) {
        groups.push(value);
      }
    }
    return groups.length;
  };

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

    const cells = await getBoardCells(env);
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

  it("keeps the board in a 3x3 layout at a smaller viewport", async () => {
    env = await createEnv();
    await env.setViewportSize(640, 360);

    await env.joinPlayer("ttt_small_x");
    await env.joinPlayer("ttt_small_o");
    await env.tick(5);
    await env.waitForUI({ type: "text", textIncludes: "Turn: X" });
    await new Promise((resolve) => setTimeout(resolve, 50));

    const cells = await getBoardCells(env);
    expect(cells).toHaveLength(9);

    const xCenters = cells.map((cell) => cell.bounds[0] + cell.bounds[2] / 2);
    const yCenters = cells.map((cell) => cell.bounds[1] + cell.bounds[3] / 2);

    expect(countUniquePositions(xCenters)).toBe(3);
    expect(countUniquePositions(yCenters)).toBe(3);
  });

  it("removes a player's oldest mark when they place a fourth move", async () => {
    env = await createEnv();

    const xPlayer = await env.joinPlayer("ttt_limit_x");
    const oPlayer = await env.joinPlayer("ttt_limit_o");

    await env.tick(5);
    await env.waitForUI({ type: "text", textIncludes: "Turn: X" });

    const cells = await getBoardCells(env);
    expect(cells).toHaveLength(9);

    await xPlayer.clickUI(cells[0].id);
    await env.tick(1);
    await oPlayer.clickUI(cells[1].id);
    await env.tick(1);
    await xPlayer.clickUI(cells[3].id);
    await env.tick(1);
    await oPlayer.clickUI(cells[2].id);
    await env.tick(1);
    await xPlayer.clickUI(cells[4].id);
    await env.tick(1);
    await oPlayer.clickUI(cells[5].id);
    await env.tick(1);
    await xPlayer.clickUI(cells[8].id);
    await env.tick(1);

    await env.waitForUI({ type: "text", textIncludes: "Turn: O" });

    const gameState = await env.queryECS({
      components: ["TicTacToeState"],
    });
    expect(gameState).toHaveLength(1);
    expect(gameState[0].components["TicTacToeState"].cells).toEqual(["", "O", "O", "X", "X", "O", "", "", "X"]);
    expect(gameState[0].components["TicTacToeState"].xMoves).toEqual([3, 4, 8]);
    expect(gameState[0].components["TicTacToeState"].oMoves).toEqual([1, 2, 5]);
    expect(gameState[0].components["TicTacToeState"].status).toBe("PLAYING");
    expect(gameState[0].components["TicTacToeState"].turn).toBe("O");

    expect(await env.getErrors()).toEqual([]);
  });
});
