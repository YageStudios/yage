import { test, expect, vi } from "vitest";
import { E2EConnectionInstance } from "yage/connection/E2EConnectionInstance";
import { InputManager } from "yage/inputs/InputManager";

const buildConnectionWithRoom = () => {
  const connection = new E2EConnectionInstance<any>(new InputManager());
  const gameModel = {
    roomId: "room",
    frame: 0,
    localNetIds: ["e2e_host"],
    runGlobalMods: vi.fn(),
  };
  connection.roomStates["room"] = { gameModel: gameModel as any, frameStack: {}, lastFrame: {} };
  connection._onPlayerJoin = vi.fn().mockReturnValue(1);
  return { connection, gameModel };
};

test("joinSimulatedPlayer preserves join order in localNetIds", () => {
  const { connection, gameModel } = buildConnectionWithRoom();

  connection.joinSimulatedPlayer("zzz_player", {});
  connection.joinSimulatedPlayer("aaa_player", {});

  // Games map inputIndex -> localNetIds[inputIndex] to route UI events; a
  // re-sorted list silently remaps players whenever netIds sort differently
  // than they joined.
  expect(gameModel.localNetIds).toEqual(["e2e_host", "zzz_player", "aaa_player"]);
});

test("joinSimulatedPlayer returns sequential input indices", () => {
  const { connection } = buildConnectionWithRoom();

  const first = connection.joinSimulatedPlayer("p_one", {});
  const second = connection.joinSimulatedPlayer("p_two", {});

  expect(first).toBe(0);
  expect(second).toBe(1);
  expect(connection.getPlayerInputIndex("p_two")).toBe(1);
});
