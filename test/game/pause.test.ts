import { afterEach, describe, expect, test } from "vitest";
import { GameInstance } from "yage/game/GameInstance";
import { isGamePaused, onGamePause, setGamePaused, toggleGamePaused } from "yage/game/pause";

afterEach(() => setGamePaused(false));

describe("engine pause", () => {
  test("one flag; listeners hear changes only; state is shared through globalThis", () => {
    const heard: boolean[] = [];
    const off = onGamePause((paused) => heard.push(paused));
    setGamePaused(true);
    setGamePaused(true);
    expect(isGamePaused()).toBe(true);
    expect(toggleGamePaused()).toBe(false);
    off();
    setGamePaused(true);
    expect(heard).toEqual([true, false]);
    // Another bundle copy of the module (or the audio runtime) sees the same state.
    expect((globalThis as any)[Symbol.for("yage.pause")].paused).toBe(true);
  });

  test("GameInstance's loop does not advance a GameModel under the engine pause", () => {
    let frames = 0;
    const instance = { options: { connection: { startFrame: () => (frames++, false) } } };
    const model = { paused: false, roomId: "r", frame: 0, localNetIds: [], getComponentActives: () => [] };
    const run = () => GameInstance.prototype.runGameLoop.call(instance as any, model as any);
    setGamePaused(true);
    expect(run()).toBe(false);
    expect(frames).toBe(0);
    setGamePaused(false);
    run();
    expect(frames).toBe(1);
  });
});
